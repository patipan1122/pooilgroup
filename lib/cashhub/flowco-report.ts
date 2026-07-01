// FlowCo sales report — reads source po_fuel_* directly (always fresh, anomaly-filtered).
// Day/month grouping, with per-fuel-type LITERS shown as table columns.
// Display-only. NB: FlowCo data is DAILY (no shift/กะ granularity in the source).
// Verified: ยอดขาย (Σ sell_a) reconciles with payment table (~0.1%); liters sum correctly.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFlowcoAggregates,
  fetchFlowcoGradeRows,
  fetchFlowcoShiftRows,
} from "./flowco-source";
import { resolveSteToBranch, FLOWCO_STATIONS } from "./flowco-branch-map";

type Admin = SupabaseClient;
const SEED_STE = new Set(FLOWCO_STATIONS.map((s) => s.steId));

// จัดชื่อน้ำมันที่มั่ว (DIESEL หลาย id, "GASOHOL 95"/"GASOHOL95") → หมวดสะอาดสำหรับคอลัมน์
const FUEL_ORDER = ["B7", "95", "B20", "91", "E20", "ดีเซล", "LPG", "E85", "อื่นๆ"];
function canonicalFuel(name: string): string {
  const n = (name || "").toUpperCase();
  if (n.includes("B7")) return "B7";
  if (n.includes("B20")) return "B20";
  if (n.includes("95")) return "95";
  if (n.includes("91")) return "91";
  if (n.includes("E20") || n.includes("E 20")) return "E20";
  if (n.includes("E85")) return "E85";
  if (n.includes("LPG")) return "LPG";
  if (n.includes("DIESEL") || n.includes("HSD") || n.includes("HIDIESEL"))
    return "ดีเซล";
  return "อื่นๆ";
}

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
  fuelLiters: Record<string, number>; // หมวดน้ำมัน → ลิตร
  shiftMorning: number; // ยอดขายกะเช้า (บาท)
  shiftEvening: number; // ยอดขายกะดึก (บาท)
}

export interface FlowcoReportTotals {
  liters: number;
  totalSales: number;
  cash: number;
  card: number;
  credit: number;
  transfer: number;
  fuelLiters: Record<string, number>;
  shiftMorning: number;
  shiftEvening: number;
}

export interface FlowcoReport {
  rows: FlowcoReportRow[];
  branches: { steId: number; name: string }[];
  totals: FlowcoReportTotals;
  fuelCols: string[]; // หมวดน้ำมันที่มีข้อมูล (เรียงแล้ว) → คอลัมน์
  hasShift: boolean; // มีข้อมูลแยกกะ (เช้า/ดึก) ไหม
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

  const [aggs, gradeRows, shiftRows, steMap] = await Promise.all([
    fetchFlowcoAggregates(admin, q.dateFrom, q.dateTo),
    fetchFlowcoGradeRows(admin, q.dateFrom, q.dateTo, steId),
    fetchFlowcoShiftRows(admin, q.dateFrom, q.dateTo, steId),
    resolveSteToBranch(admin, orgId),
  ]);

  const nameOf = (ste: number): string => {
    const mapped = steMap.get(ste)?.name;
    if (mapped) return mapped.replace(/^ปั๊มน้ำมัน - /, "");
    const seed = FLOWCO_STATIONS.find((s) => s.steId === ste);
    return seed?.name ?? `สาขา ${ste}`;
  };
  const keyOf = (date: string) => (mode === "month" ? date.slice(0, 7) : date);
  const inScope = (ste: number) => SEED_STE.has(ste) && (!steId || ste === steId);

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
        fuelLiters: {},
        shiftMorning: 0,
        shiftEvening: 0,
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
  }

  // per-row liters แยกตามหมวดน้ำมัน
  const fuelTotal: Record<string, number> = {};
  for (const g of gradeRows) {
    if (!inScope(g.steId)) continue;
    const r = getRow(keyOf(g.reportDate));
    const bucket = canonicalFuel(g.gradeName);
    r.fuelLiters[bucket] = (r.fuelLiters[bucket] ?? 0) + g.liters;
    fuelTotal[bucket] = (fuelTotal[bucket] ?? 0) + g.liters;
  }

  // ยอดขายแยกกะ (เช้า/ดึก) ต่อ row
  let shiftGrand = 0;
  for (const sh of shiftRows) {
    if (!inScope(sh.steId)) continue;
    const r = getRow(keyOf(sh.reportDate));
    if (sh.shiftNo === 2) r.shiftEvening += sh.baht;
    else r.shiftMorning += sh.baht;
    shiftGrand += sh.baht;
  }
  const hasShift = shiftGrand > 0.5;

  const fuelCols = FUEL_ORDER.filter((b) => (fuelTotal[b] ?? 0) > 0.5);
  const rows = [...rowMap.values()].sort((x, y) => (x.key < y.key ? 1 : -1));

  const totals: FlowcoReportTotals = {
    liters: 0,
    totalSales: 0,
    cash: 0,
    card: 0,
    credit: 0,
    transfer: 0,
    fuelLiters: {},
    shiftMorning: 0,
    shiftEvening: 0,
  };
  for (const r of rows) {
    totals.liters += r.liters;
    totals.totalSales += r.totalSales;
    totals.cash += r.cash;
    totals.card += r.card;
    totals.credit += r.credit;
    totals.transfer += r.transfer;
    totals.shiftMorning += r.shiftMorning;
    totals.shiftEvening += r.shiftEvening;
    for (const b of fuelCols)
      totals.fuelLiters[b] = (totals.fuelLiters[b] ?? 0) + (r.fuelLiters[b] ?? 0);
  }
  const anomalyTotal = rows.reduce((s, r) => s + r.anomalyCount, 0);

  const branches = [...FLOWCO_STATIONS]
    .sort((a, b) => a.steId - b.steId)
    .map((s) => ({ steId: s.steId, name: nameOf(s.steId) }));

  return {
    rows,
    branches,
    totals,
    fuelCols,
    hasShift,
    anomalyTotal,
    mode,
    steId,
    branchName: steId ? nameOf(steId) : null,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
  };
}
