// FlowCo sales report — reads the source po_fuel_* tables directly (always fresh,
// full detail) and shapes a per-day × per-branch table with payment-method breakdown.
// Display-only. NB: FlowCo data is DAILY (no shift granularity) — the source has one
// record per station per business day, so there is no morning/evening split to show.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFlowcoAggregates, type FlowcoDayAgg } from "./flowco-source";
import { resolveSteToBranch, FLOWCO_STATIONS } from "./flowco-branch-map";

type Admin = SupabaseClient;

const SEED_STE = new Set(FLOWCO_STATIONS.map((s) => s.steId));

export interface FlowcoReportRow extends FlowcoDayAgg {
  branchName: string;
}

export interface FlowcoReportTotals {
  liters: number;
  totalSales: number;
  cash: number;
  card: number;
  credit: number;
  transfer: number;
  payOther: number;
  days: number;
}

export interface FlowcoBranchSummary {
  steId: number;
  name: string;
  totalSales: number;
  liters: number;
  days: number;
}

export interface FlowcoReport {
  rows: FlowcoReportRow[];
  branches: { steId: number; name: string }[];
  branchSummary: FlowcoBranchSummary[];
  totals: FlowcoReportTotals;
  grandTotalSales: number; // ยอดรวมทุกสาขา (ไม่ขึ้นกับ filter สาขา)
  dateFrom: string;
  dateTo: string;
  steId: number | null;
}

export interface FlowcoReportQuery {
  dateFrom: string;
  dateTo: string;
  steId?: number | null;
}

export async function fetchFlowcoReport(
  admin: Admin,
  orgId: string,
  q: FlowcoReportQuery,
): Promise<FlowcoReport> {
  const [aggs, steMap] = await Promise.all([
    fetchFlowcoAggregates(admin, q.dateFrom, q.dateTo),
    resolveSteToBranch(admin, orgId),
  ]);

  const nameOf = (ste: number): string => {
    const mapped = steMap.get(ste)?.name;
    if (mapped) return mapped.replace(/^ปั๊มน้ำมัน - /, "");
    const seed = FLOWCO_STATIONS.find((s) => s.steId === ste);
    return seed?.name ?? `สาขา ${ste}`;
  };

  // เฉพาะสาขาในลิสต์ (กัน 3001/62 ที่ ฿0)
  const seedAggs = aggs.filter((a) => SEED_STE.has(a.steId));

  // สรุปต่อสาขา (ทุกสาขา — ไม่ขึ้นกับ filter) สำหรับการ์ดกดเลือกสาขา
  const bsMap = new Map<number, FlowcoBranchSummary>();
  for (const a of seedAggs) {
    const b = bsMap.get(a.steId) ?? {
      steId: a.steId,
      name: nameOf(a.steId),
      totalSales: 0,
      liters: 0,
      days: 0,
    };
    b.totalSales += a.totalSales;
    b.liters += a.liters;
    b.days += 1;
    bsMap.set(a.steId, b);
  }
  const branchSummary = [...bsMap.values()].sort(
    (a, b) => b.totalSales - a.totalSales,
  );
  const grandTotalSales = branchSummary.reduce((s, b) => s + b.totalSales, 0);

  const rows: FlowcoReportRow[] = seedAggs
    .filter((a) => !q.steId || a.steId === q.steId)
    .map((a) => ({ ...a, branchName: nameOf(a.steId) }))
    .sort((x, y) =>
      x.reportDate === y.reportDate
        ? x.steId - y.steId
        : x.reportDate < y.reportDate
          ? 1
          : -1,
    );

  const totals = rows.reduce<FlowcoReportTotals>(
    (t, r) => ({
      liters: t.liters + r.liters,
      totalSales: t.totalSales + r.totalSales,
      cash: t.cash + r.cash,
      card: t.card + r.card,
      credit: t.credit + r.credit,
      transfer: t.transfer + r.transfer,
      payOther: t.payOther + r.payOther,
      days: t.days + 1,
    }),
    { liters: 0, totalSales: 0, cash: 0, card: 0, credit: 0, transfer: 0, payOther: 0, days: 0 },
  );

  // ตัวเลือก filter = สาขาในลิสต์ (เรียงตาม ste)
  const branches = [...FLOWCO_STATIONS]
    .sort((a, b) => a.steId - b.steId)
    .map((s) => ({ steId: s.steId, name: nameOf(s.steId) }));

  return {
    rows,
    branches,
    branchSummary,
    totals,
    grandTotalSales,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    steId: q.steId ?? null,
  };
}
