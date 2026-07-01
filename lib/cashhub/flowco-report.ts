// FlowCo sales report — reads source po_fuel_* directly (always fresh, anomaly-filtered).
// Supports day/month grouping + per-fuel-grade breakdown (for expandable rows).
// Display-only. NB: FlowCo data is DAILY (no shift/กะ granularity in the source).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFlowcoAggregates,
  fetchFlowcoGradeRows,
} from "./flowco-source";
import { resolveSteToBranch, FLOWCO_STATIONS } from "./flowco-branch-map";

type Admin = SupabaseClient;
const SEED_STE = new Set(FLOWCO_STATIONS.map((s) => s.steId));

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${TH_MONTHS[m - 1]} ${y + 543}`; // พ.ศ. = ค.ศ. + 543
}
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

export type FlowcoMode = "day" | "month";

export interface FlowcoGradeCell {
  gradeId: number;
  grade: string;
  liters: number;
  sales: number;
}

export interface FlowcoReportRow {
  key: string; // "2026-06-30" (day) หรือ "2026-06" (month)
  label: string;
  liters: number;
  totalSales: number;
  cash: number;
  card: number;
  credit: number;
  transfer: number;
  anomalyCount: number;
  days: number; // จำนวนวัน-สาขา ที่รวมในแถวนี้
  grades: FlowcoGradeCell[];
}

export interface FlowcoReportTotals {
  liters: number;
  totalSales: number;
  cash: number;
  card: number;
  credit: number;
  transfer: number;
}

export interface FlowcoReport {
  rows: FlowcoReportRow[];
  branches: { steId: number; name: string }[];
  totals: FlowcoReportTotals;
  anomalyTotal: number;
  mode: FlowcoMode;
  steId: number | null;
  branchName: string | null;
  dateFrom: string;
  dateTo: string;
}

export interface FlowcoReportQuery {
  dateFrom: string;
  dateTo: string;
  steId?: number | null;
  mode?: FlowcoMode;
}

export async function fetchFlowcoReport(
  admin: Admin,
  orgId: string,
  q: FlowcoReportQuery,
): Promise<FlowcoReport> {
  const mode: FlowcoMode = q.mode === "month" ? "month" : "day";
  const steId = q.steId ?? null;

  const [aggs, gradeRows, steMap] = await Promise.all([
    fetchFlowcoAggregates(admin, q.dateFrom, q.dateTo),
    fetchFlowcoGradeRows(admin, q.dateFrom, q.dateTo, steId),
    resolveSteToBranch(admin, orgId),
  ]);

  const nameOf = (ste: number): string => {
    const mapped = steMap.get(ste)?.name;
    if (mapped) return mapped.replace(/^ปั๊มน้ำมัน - /, "");
    const seed = FLOWCO_STATIONS.find((s) => s.steId === ste);
    return seed?.name ?? `สาขา ${ste}`;
  };
  const keyOf = (date: string) => (mode === "month" ? date.slice(0, 7) : date);

  // filter to report stations (+ branch filter)
  const inScope = (ste: number) => SEED_STE.has(ste) && (!steId || ste === steId);

  // group aggregates → rows
  const rowMap = new Map<string, FlowcoReportRow>();
  const getRow = (key: string): FlowcoReportRow => {
    let r = rowMap.get(key);
    if (!r) {
      r = {
        key,
        label: mode === "month" ? monthLabel(key) : dayLabel(key),
        liters: 0,
        totalSales: 0,
        cash: 0,
        card: 0,
        credit: 0,
        transfer: 0,
        anomalyCount: 0,
        days: 0,
        grades: [],
      };
      rowMap.set(key, r);
    }
    return r;
  };

  for (const a of aggs) {
    if (!inScope(a.steId)) continue;
    const r = getRow(keyOf(a.reportDate));
    r.liters += a.liters;
    r.totalSales += a.totalSales;
    r.cash += a.cash;
    r.card += a.card;
    r.credit += a.credit;
    r.transfer += a.transfer;
    r.anomalyCount += a.anomalyCount;
    r.days += 1;
  }

  // group grade rows → per-row fuel-type cells (by gradeId)
  const gradeByRow = new Map<string, Map<number, FlowcoGradeCell>>();
  for (const g of gradeRows) {
    if (!inScope(g.steId)) continue;
    const rk = keyOf(g.reportDate);
    let gm = gradeByRow.get(rk);
    if (!gm) {
      gm = new Map();
      gradeByRow.set(rk, gm);
    }
    let cell = gm.get(g.gradeId);
    if (!cell) {
      cell = { gradeId: g.gradeId, grade: g.gradeName, liters: 0, sales: 0 };
      gm.set(g.gradeId, cell);
    }
    cell.liters += g.liters;
    cell.sales += g.sales;
  }
  for (const [rk, gm] of gradeByRow) {
    const r = rowMap.get(rk);
    if (r) r.grades = [...gm.values()].sort((x, y) => y.sales - x.sales);
  }

  // rows sorted newest first
  const rows = [...rowMap.values()].sort((x, y) => (x.key < y.key ? 1 : -1));

  const totals = rows.reduce<FlowcoReportTotals>(
    (t, r) => ({
      liters: t.liters + r.liters,
      totalSales: t.totalSales + r.totalSales,
      cash: t.cash + r.cash,
      card: t.card + r.card,
      credit: t.credit + r.credit,
      transfer: t.transfer + r.transfer,
    }),
    { liters: 0, totalSales: 0, cash: 0, card: 0, credit: 0, transfer: 0 },
  );
  const anomalyTotal = rows.reduce((s, r) => s + r.anomalyCount, 0);

  const branches = [...FLOWCO_STATIONS]
    .sort((a, b) => a.steId - b.steId)
    .map((s) => ({ steId: s.steId, name: nameOf(s.steId) }));

  return {
    rows,
    branches,
    totals,
    anomalyTotal,
    mode,
    steId,
    branchName: steId ? nameOf(steId) : null,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
  };
}
