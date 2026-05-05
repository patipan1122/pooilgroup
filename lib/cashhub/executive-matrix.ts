// Executive overview: matrix of [business_type × month] total sales
// Used for compact multi-month comparison table on /cashhub/dashboard.
// Data-dense — designed for owner/board to scan in 5 seconds.

import { adminClient } from "@/lib/db/server";
import { startOfMonth, subMonths, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export interface ExecutiveMatrix {
  /** Reverse-chronological YYYY-MM keys: ["2026-05", "2026-04", "2026-03"] */
  monthKeys: string[];
  /** Display labels matching monthKeys: ["พ.ค. 69", "เม.ย. 69", "มี.ค. 69"] */
  monthLabels: string[];
  /** Per business type: { businessType, totals: [byMonth] } */
  rows: Array<{
    businessType: string;
    totals: number[];
    branchCount: number;
  }>;
  /** Footer totals across all business types per month */
  monthlyTotals: number[];
  /** Cell-level diff vs previous column (positive = up, negative = down) */
  monthlyChangePct: (number | null)[];
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                   "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function thaiMonthLabel(yyyymm: string): string {
  const [yyyy, mm] = yyyymm.split("-").map((s) => parseInt(s, 10));
  const yearBE = (yyyy + 543) % 100;
  return `${TH_MONTHS[mm - 1]} ${String(yearBE).padStart(2, "0")}`;
}

/**
 * Load N months of sales data, grouped by business_type × month.
 * months: how many months back (default 6 — covers half year for good comparison)
 */
export async function loadExecutiveMatrix(
  orgId: string,
  months: number = 6,
): Promise<ExecutiveMatrix> {
  const admin = adminClient();
  const now = new Date();

  // Build month key list: most recent first
  const monthKeys: string[] = [];
  const monthLabels: string[] = [];
  for (let i = 0; i < months; i++) {
    const m = startOfMonth(subMonths(now, i));
    const key = formatInTimeZone(m, TZ, "yyyy-MM");
    monthKeys.push(key);
    monthLabels.push(thaiMonthLabel(key));
  }

  // Window: from start of oldest month to today
  const oldestStart = formatInTimeZone(
    startOfMonth(subMonths(now, months - 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");

  // Pull all approved reports in window with branch business_type
  const { data: reports } = await admin
    .from("daily_reports")
    .select("report_date, total_sales, status, branch_id, branches(business_type)")
    .eq("org_id", orgId)
    .gte("report_date", oldestStart)
    .lte("report_date", todayKey)
    .in("status", ["approved", "submitted"]); // count submitted as expected revenue

  // Branch active count per business type
  const { data: branches } = await admin
    .from("branches")
    .select("business_type")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const branchCountByType = new Map<string, number>();
  for (const b of branches ?? []) {
    const bt = (b as { business_type: string }).business_type;
    branchCountByType.set(bt, (branchCountByType.get(bt) ?? 0) + 1);
  }

  // Aggregate: type → month → sum
  type Bucket = Record<string, number>;
  const matrix = new Map<string, Bucket>();

  for (const r of reports ?? []) {
    const row = r as {
      report_date: string;
      total_sales: number | string;
      branches:
        | { business_type: string }
        | { business_type: string }[]
        | null;
    };
    const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches;
    if (!branch) continue;
    const bt = branch.business_type;
    const month = row.report_date.slice(0, 7); // YYYY-MM

    const bucket = matrix.get(bt) ?? {};
    bucket[month] = (bucket[month] ?? 0) + Number(row.total_sales || 0);
    matrix.set(bt, bucket);
  }

  // Build rows in stable order — biggest current-month first
  const allTypes = Array.from(
    new Set([
      ...Array.from(branchCountByType.keys()),
      ...Array.from(matrix.keys()),
    ]),
  );

  const rows = allTypes
    .map((bt) => {
      const bucket = matrix.get(bt) ?? {};
      const totals = monthKeys.map((mk) => bucket[mk] ?? 0);
      return {
        businessType: bt,
        totals,
        branchCount: branchCountByType.get(bt) ?? 0,
      };
    })
    // Sort by current month desc — top performers first
    .sort((a, b) => b.totals[0] - a.totals[0]);

  // Footer totals per month
  const monthlyTotals = monthKeys.map((_, idx) =>
    rows.reduce((sum, r) => sum + r.totals[idx], 0),
  );

  // Month-over-month change % (compared to previous month i.e. monthKeys[i+1])
  const monthlyChangePct: (number | null)[] = monthlyTotals.map((cur, i) => {
    const prev = monthlyTotals[i + 1];
    if (!prev || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  });

  return {
    monthKeys,
    monthLabels,
    rows,
    monthlyTotals,
    monthlyChangePct,
  };
}
