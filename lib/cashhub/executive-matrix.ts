// Executive overview: matrix of [business_type × period] total sales
// Used for compact multi-period comparison table on /cashhub/dashboard.
// Each business type row also carries branch-level breakdown for expand.

import {
  startOfMonth,
  subMonths,
  startOfDay,
  subDays,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { loadBranches, loadReports, indexBranches } from "./data";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export type Period = "daily" | "monthly";

export interface BranchTotals {
  id: string;
  code: string;
  name: string;
  totals: number[];
}

export interface ExecutiveMatrix {
  period: Period;
  /** Reverse-chronological keys (newest first inside data, but rendered oldest→newest) */
  periodKeys: string[];
  /** Display labels matching periodKeys */
  periodLabels: string[];
  rows: Array<{
    businessType: string;
    totals: number[];
    branchCount: number;
    /** Distinct branches that submitted at least one report per period */
    reportedCounts: number[];
    branches: BranchTotals[];
  }>;
  /** Footer totals across all business types per period */
  periodTotals: number[];
  /** Distinct branches that submitted across all types per period */
  periodReportedCounts: number[];
  /** Total active branches across all types (denominator for periodReportedCounts) */
  totalBranchCount: number;
}

const TH_MONTHS = [
  "ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
  "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.",
];

// 0=sun ... 6=sat, matching JS Date.getDay()
const TH_DOW_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

function thaiMonthLabel(yyyymm: string): string {
  const [yyyy, mm] = yyyymm.split("-").map((s) => parseInt(s, 10));
  const yearBE = (yyyy + 543) % 100;
  return `${TH_MONTHS[mm - 1]} ${String(yearBE).padStart(2, "0")}`;
}

function thaiDayLabel(yyyymmdd: string): string {
  const parts = yyyymmdd.split("-").map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  // Build a noon-UTC date so getDay() in BKK is stable (avoid TZ slippage)
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getDay();
  // "อ. 5 พ.ค." — weekday + day + month (no year)
  return `${TH_DOW_SHORT[dow]} ${d} ${TH_MONTHS[m - 1]}`;
}

/**
 * Load N periods of sales data, grouped by business_type × period.
 * - monthly: last N months (default 6)
 * - daily:   last N days (default 30) — covers full current month
 * - companyId: filter by legal entity (Pooil Oil / JP Sync Group)
 */
export async function loadExecutiveMatrix(
  orgId: string,
  options: { period?: Period; count?: number; companyId?: string } = {},
): Promise<ExecutiveMatrix> {
  const period: Period = options.period ?? "monthly";
  const count = options.count ?? (period === "daily" ? 30 : 6);
  const { companyId } = options;

  const now = new Date();

  // Build period keys (newest first)
  const periodKeys: string[] = [];
  const periodLabels: string[] = [];
  let oldestStart: string;

  if (period === "monthly") {
    for (let i = 0; i < count; i++) {
      const m = startOfMonth(subMonths(now, i));
      const key = formatInTimeZone(m, TZ, "yyyy-MM");
      periodKeys.push(key);
      periodLabels.push(thaiMonthLabel(key));
    }
    oldestStart = formatInTimeZone(
      startOfMonth(subMonths(now, count - 1)),
      TZ,
      "yyyy-MM-dd",
    );
  } else {
    // daily
    for (let i = 0; i < count; i++) {
      const d = startOfDay(subDays(now, i));
      const key = formatInTimeZone(d, TZ, "yyyy-MM-dd");
      periodKeys.push(key);
      periodLabels.push(thaiDayLabel(key));
    }
    oldestStart = formatInTimeZone(
      startOfDay(subDays(now, count - 1)),
      TZ,
      "yyyy-MM-dd",
    );
  }

  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");

  // Canonical branch + report loaders — single source of truth
  const branches = await loadBranches(orgId, { companyId });
  const branchById = indexBranches(branches);
  const allowedBranchIds = Array.from(branchById.keys());

  const reports = await loadReports(orgId, {
    dateFrom: oldestStart,
    dateTo: todayKey,
    branchIds: companyId ? allowedBranchIds : undefined,
  });

  // Branch count per business type (denominator for "X/Y กรอกแล้ว")
  const branchCountByType = new Map<string, number>();
  for (const b of branches) {
    branchCountByType.set(
      b.business_type,
      (branchCountByType.get(b.business_type) ?? 0) + 1,
    );
  }

  // Aggregate: type → { typeTotal[i], branches: { branch_id → totals[i] }, reportedBranches per period }
  type TypeBucket = {
    totals: Map<string, number>;
    branches: Map<string, Map<string, number>>;
    /** periodKey → set of branch_ids that submitted at least once that period */
    reportedByPeriod: Map<string, Set<string>>;
  };
  const typeBuckets = new Map<string, TypeBucket>();

  function getBucket(type: string): TypeBucket {
    let b = typeBuckets.get(type);
    if (!b) {
      b = { totals: new Map(), branches: new Map(), reportedByPeriod: new Map() };
      typeBuckets.set(type, b);
    }
    return b;
  }

  function bucketKey(reportDate: string): string | null {
    if (period === "monthly") return reportDate.slice(0, 7);
    return reportDate;
  }

  for (const r of reports) {
    const branch = branchById.get(r.branch_id);
    if (!branch) continue;
    const key = bucketKey(r.report_date);
    if (!key) continue;

    const bucket = getBucket(branch.business_type);
    bucket.totals.set(
      key,
      (bucket.totals.get(key) ?? 0) + Number(r.total_sales || 0),
    );

    let branchMap = bucket.branches.get(branch.id);
    if (!branchMap) {
      branchMap = new Map();
      bucket.branches.set(branch.id, branchMap);
    }
    branchMap.set(key, (branchMap.get(key) ?? 0) + Number(r.total_sales || 0));

    // Track distinct reporting branches per period for "X/Y สาขา" indicator
    let periodSet = bucket.reportedByPeriod.get(key);
    if (!periodSet) {
      periodSet = new Set();
      bucket.reportedByPeriod.set(key, periodSet);
    }
    periodSet.add(branch.id);
  }

  // Build rows
  const allTypes = Array.from(
    new Set([
      ...Array.from(branchCountByType.keys()),
      ...Array.from(typeBuckets.keys()),
    ]),
  );

  const rows = allTypes
    .map((bt) => {
      const bucket = typeBuckets.get(bt);
      const totals = periodKeys.map((pk) => bucket?.totals.get(pk) ?? 0);
      const reportedCounts = periodKeys.map(
        (pk) => bucket?.reportedByPeriod.get(pk)?.size ?? 0,
      );

      // All branches under this type — include those with NO data (zero row)
      const branchEntries = Array.from(branchById.values()).filter(
        (b) => b.business_type === bt,
      );

      const branchTotals: BranchTotals[] = branchEntries
        .map((b) => {
          const bMap = bucket?.branches.get(b.id);
          const tot = periodKeys.map((pk) => bMap?.get(pk) ?? 0);
          return {
            id: b.id,
            code: b.code,
            name: b.name,
            totals: tot,
          };
        })
        // Sort branches by latest-period total desc
        .sort((a, b) => b.totals[0] - a.totals[0]);

      return {
        businessType: bt,
        totals,
        reportedCounts,
        branchCount: branchCountByType.get(bt) ?? 0,
        branches: branchTotals,
      };
    })
    .sort((a, b) => b.totals[0] - a.totals[0]);

  const periodTotals = periodKeys.map((_, i) =>
    rows.reduce((sum, r) => sum + r.totals[i], 0),
  );
  const periodReportedCounts = periodKeys.map((_, i) =>
    rows.reduce((sum, r) => sum + r.reportedCounts[i], 0),
  );
  const totalBranchCount = rows.reduce((sum, r) => sum + r.branchCount, 0);

  return {
    period,
    periodKeys,
    periodLabels,
    rows,
    periodTotals,
    periodReportedCounts,
    totalBranchCount,
  };
}
