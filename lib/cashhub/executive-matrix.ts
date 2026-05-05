// Executive overview: matrix of [business_type × period] total sales
// Used for compact multi-period comparison table on /cashhub/dashboard.
// Each business type row also carries branch-level breakdown for expand.

import { adminClient } from "@/lib/db/server";
import {
  startOfMonth,
  subMonths,
  startOfDay,
  subDays,
  format,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

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
    branches: BranchTotals[];
  }>;
  /** Footer totals across all business types per period */
  periodTotals: number[];
}

const TH_MONTHS = [
  "ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
  "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.",
];

function thaiMonthLabel(yyyymm: string): string {
  const [yyyy, mm] = yyyymm.split("-").map((s) => parseInt(s, 10));
  const yearBE = (yyyy + 543) % 100;
  return `${TH_MONTHS[mm - 1]} ${String(yearBE).padStart(2, "0")}`;
}

function thaiDayLabel(yyyymmdd: string): string {
  const parts = yyyymmdd.split("-").map((s) => parseInt(s, 10));
  const m = parts[1];
  const d = parts[2];
  // "5 พ.ค." (no year — too noisy)
  return `${d} ${TH_MONTHS[m - 1]}`;
}

/**
 * Load N periods of sales data, grouped by business_type × period.
 * - monthly: last N months (default 6)
 * - daily:   last N days (default 30) — covers full current month
 */
export async function loadExecutiveMatrix(
  orgId: string,
  options: { period?: Period; count?: number } = {},
): Promise<ExecutiveMatrix> {
  const period: Period = options.period ?? "monthly";
  const count = options.count ?? (period === "daily" ? 30 : 6);

  const admin = adminClient();
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

  // Pull all reports in window with branch info
  const { data: reports } = await admin
    .from("daily_reports")
    .select(
      "report_date, total_sales, status, branch_id, branches(id, code, name, business_type)",
    )
    .eq("org_id", orgId)
    .gte("report_date", oldestStart)
    .lte("report_date", todayKey)
    .in("status", ["approved", "submitted"]);

  // Branch metadata
  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);

  // Build branch lookup + count by type
  const branchById = new Map<
    string,
    { id: string; code: string; name: string; business_type: string }
  >();
  const branchCountByType = new Map<string, number>();
  for (const b of branches ?? []) {
    const row = b as {
      id: string;
      code: string;
      name: string;
      business_type: string;
    };
    branchById.set(row.id, row);
    branchCountByType.set(
      row.business_type,
      (branchCountByType.get(row.business_type) ?? 0) + 1,
    );
  }

  // Aggregate: type → { typeTotal[i], branches: { branch_id → totals[i] } }
  type TypeBucket = {
    totals: Map<string, number>;
    branches: Map<string, Map<string, number>>;
  };
  const typeBuckets = new Map<string, TypeBucket>();

  function getBucket(type: string): TypeBucket {
    let b = typeBuckets.get(type);
    if (!b) {
      b = { totals: new Map(), branches: new Map() };
      typeBuckets.set(type, b);
    }
    return b;
  }

  function bucketKey(reportDate: string): string | null {
    if (period === "monthly") return reportDate.slice(0, 7);
    return reportDate;
  }

  for (const r of reports ?? []) {
    const row = r as {
      report_date: string;
      total_sales: number | string;
      branch_id: string;
      branches:
        | { id: string; code: string; name: string; business_type: string }
        | { id: string; code: string; name: string; business_type: string }[]
        | null;
    };
    const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches;
    if (!branch) continue;
    const key = bucketKey(row.report_date);
    if (!key) continue;

    const bucket = getBucket(branch.business_type);
    bucket.totals.set(
      key,
      (bucket.totals.get(key) ?? 0) + Number(row.total_sales || 0),
    );

    let branchMap = bucket.branches.get(branch.id);
    if (!branchMap) {
      branchMap = new Map();
      bucket.branches.set(branch.id, branchMap);
    }
    branchMap.set(key, (branchMap.get(key) ?? 0) + Number(row.total_sales || 0));
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
        branchCount: branchCountByType.get(bt) ?? 0,
        branches: branchTotals,
      };
    })
    .sort((a, b) => b.totals[0] - a.totals[0]);

  const periodTotals = periodKeys.map((_, i) =>
    rows.reduce((sum, r) => sum + r.totals[i], 0),
  );

  return {
    period,
    periodKeys,
    periodLabels,
    rows,
    periodTotals,
  };
}
