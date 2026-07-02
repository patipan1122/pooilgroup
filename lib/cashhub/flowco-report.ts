// FlowCo sales report — reads source po_fuel_* directly (always fresh, anomaly-filtered).
// Day/month grouping, with per-fuel-type LITERS shown as table columns.
// Display-only. NB: FlowCo data is DAILY (no shift/กะ granularity in the source).
// Verified: ยอดขาย (Σ sell_a) reconciles with payment table (~0.1%); liters sum correctly.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFlowcoAggregates,
  fetchFlowcoGradeRows,
  fetchFlowcoShiftRows,
  fetchFlowcoShiftPaymentRows,
  payBucket,
} from "./flowco-source";
import { resolveSteToBranch, FLOWCO_STATIONS } from "./flowco-branch-map";

/** ชื่อกะ (3-6 = เดา · ยืนยันกับ CEO: ตัดสต๊อค/สิ้นเดือน) */
export const SHIFT_LABELS: Record<number, string> = {
  1: "กะเช้า",
  2: "กะดึก",
  3: "กะตัดสต๊อค",
  4: "กะสิ้นเดือน",
  5: "กะพิเศษ 5",
  6: "กะพิเศษ 6",
};
function shiftLabel(no: number): string {
  return SHIFT_LABELS[no] ?? `กะ ${no}`;
}

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

export type FlowcoMode = "day" | "month" | "shift";

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
  const mode: FlowcoMode =
    q.mode === "month" ? "month" : q.mode === "shift" ? "shift" : "day";
  const steId = q.steId ?? null;

  const nameOfFrom =
    (steMap: Map<number, { id: string; name: string }>) =>
    (ste: number): string => {
      const mapped = steMap.get(ste)?.name;
      if (mapped) return mapped.replace(/^ปั๊มน้ำมัน - /, "");
      const seed = FLOWCO_STATIONS.find((s) => s.steId === ste);
      return seed?.name ?? `สาขา ${ste}`;
    };

  // ── โหมดรายกะ: แต่ละแถว = 1 กะ (เช้า/ดึก/ตัดสต๊อค/สิ้นเดือน) พร้อมยอด+วิธีจ่ายต่อกะ ──
  if (mode === "shift") {
    return fetchShiftModeReport(admin, orgId, q, steId, nameOfFrom);
  }

  const [aggs, gradeRows, shiftRows, steMap] = await Promise.all([
    fetchFlowcoAggregates(admin, q.dateFrom, q.dateTo),
    fetchFlowcoGradeRows(admin, q.dateFrom, q.dateTo, steId),
    fetchFlowcoShiftRows(admin, q.dateFrom, q.dateTo, steId),
    resolveSteToBranch(admin, orgId),
  ]);

  const nameOf = nameOfFrom(steMap);
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

// ════════════════════════════════════════════════════════════════════════
// รายงาน "สรุปทุกสาขา" (matrix) — แถว = สาขา · คอลัมน์ = เดือน/วัน · ค่า = ยอดขาย/ลิตร
// อ่านสด ๆ จาก po_fuel_* (กรองค่าเพี้ยนแล้ว) · รายวัน+แยกกะ (เช้า/ดึก) ได้
// ════════════════════════════════════════════════════════════════════════

export type FlowcoMatrixMode = "day" | "month";

export interface FlowcoMatrixCell {
  baht: number;
  liters: number;
  mBaht: number; // ยอดกะเช้า (บาท)
  mLit: number; // ลิตรกะเช้า
  eBaht: number; // ยอดกะดึก (บาท)
  eLit: number; // ลิตรกะดึก
  anomaly: number;
}

export interface FlowcoMatrixRow {
  steId: number;
  name: string;
  cells: Record<string, FlowcoMatrixCell>; // periodKey → cell
  totalBaht: number;
  totalLiters: number;
  hasShiftData: boolean; // สาขานี้มีข้อมูลแยกกะไหม
}

export interface FlowcoMatrix {
  mode: FlowcoMatrixMode;
  periodKeys: string[]; // เรียงเก่า→ใหม่ (ซ้าย→ขวา)
  periodLabels: string[];
  rows: FlowcoMatrixRow[]; // ทุกสาขา (21) เรียงตาม steId
  colTotals: Record<string, FlowcoMatrixCell>;
  grandBaht: number;
  grandLiters: number;
  hasShift: boolean;
  anomalyTotal: number;
  dateFrom: string;
  dateTo: string;
}

function addDaysYmdLocal(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** enumerate YYYY-MM keys ระหว่าง from..to (รวมปลายทั้งสอง) */
function enumMonths(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  // กันวนไม่จบ: cap 60 เดือน
  for (let i = 0; i < 60; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === ty && m === tm) break;
    if (y > ty || (y === ty && m >= tm)) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** enumerate YYYY-MM-DD keys ระหว่าง from..to (รวมปลายทั้งสอง · cap 120 วัน กันตารางบวม) */
function enumDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = addDaysYmdLocal(cur, 1);
  }
  // ถ้ายาวเกิน 120 วัน เอาเฉพาะช่วงท้าย (วันล่าสุด) — กันตารางกว้างเกิน
  return out.length > 120 ? out.slice(out.length - 120) : out;
}

const emptyMatrixCell = (): FlowcoMatrixCell => ({
  baht: 0, liters: 0, mBaht: 0, mLit: 0, eBaht: 0, eLit: 0, anomaly: 0,
});

export interface FlowcoMatrixQuery {
  dateFrom: string;
  dateTo: string;
  mode?: FlowcoMatrixMode;
}

export async function fetchFlowcoMatrix(
  admin: Admin,
  orgId: string,
  q: FlowcoMatrixQuery,
): Promise<FlowcoMatrix> {
  const mode: FlowcoMatrixMode = q.mode === "month" ? "month" : "day";

  const [aggs, shiftRows, steMap] = await Promise.all([
    fetchFlowcoAggregates(admin, q.dateFrom, q.dateTo),
    // แยกกะ เฉพาะโหมดรายวัน (รายเดือนไม่แตกกะ)
    mode === "day"
      ? fetchFlowcoShiftRows(admin, q.dateFrom, q.dateTo, null)
      : Promise.resolve([]),
    resolveSteToBranch(admin, orgId),
  ]);

  const nameOf = (ste: number): string => {
    const mapped = steMap.get(ste)?.name;
    if (mapped) return mapped.replace(/^ปั๊มน้ำมัน - /, "");
    return FLOWCO_STATIONS.find((s) => s.steId === ste)?.name ?? `สาขา ${ste}`;
  };

  const periodKeys =
    mode === "month"
      ? enumMonths(q.dateFrom, q.dateTo)
      : enumDays(q.dateFrom, q.dateTo);
  const periodSet = new Set(periodKeys);
  const periodLabels = periodKeys.map((k) =>
    mode === "month" ? monthLabel(k) : dayLabel(k),
  );
  const keyOf = (date: string) => (mode === "month" ? date.slice(0, 7) : date);

  // ทุกสาขา (21) เรียงตาม steId
  const rows: FlowcoMatrixRow[] = [...FLOWCO_STATIONS]
    .sort((a, b) => a.steId - b.steId)
    .map((s) => ({
      steId: s.steId,
      name: nameOf(s.steId),
      cells: {},
      totalBaht: 0,
      totalLiters: 0,
      hasShiftData: false,
    }));
  const rowBySte = new Map(rows.map((r) => [r.steId, r]));
  const cellOf = (row: FlowcoMatrixRow, pk: string): FlowcoMatrixCell => {
    let c = row.cells[pk];
    if (!c) { c = emptyMatrixCell(); row.cells[pk] = c; }
    return c;
  };

  for (const a of aggs) {
    const row = rowBySte.get(a.steId);
    if (!row) continue; // นอกลิสต์ 21 สาขา
    const pk = keyOf(a.reportDate);
    if (!periodSet.has(pk)) continue;
    const c = cellOf(row, pk);
    c.baht += a.totalSales;
    c.liters += a.liters;
    c.anomaly += a.anomalyCount;
  }

  let shiftGrand = 0;
  for (const sh of shiftRows) {
    const row = rowBySte.get(sh.steId);
    if (!row) continue;
    const pk = keyOf(sh.reportDate);
    if (!periodSet.has(pk)) continue;
    const c = cellOf(row, pk);
    if (sh.shiftNo === 2) { c.eBaht += sh.baht; c.eLit += sh.liters; }
    else { c.mBaht += sh.baht; c.mLit += sh.liters; } // 1,3,4,5,6 → เช้า (ตรงกับรายงานเดิม)
    row.hasShiftData = true;
    shiftGrand += sh.baht;
  }

  // totals ต่อสาขา + ต่อคอลัมน์ + grand
  const colTotals: Record<string, FlowcoMatrixCell> = {};
  for (const pk of periodKeys) colTotals[pk] = emptyMatrixCell();
  let grandBaht = 0;
  let grandLiters = 0;
  let anomalyTotal = 0;
  for (const row of rows) {
    for (const pk of periodKeys) {
      const c = row.cells[pk];
      if (!c) continue;
      row.totalBaht += c.baht;
      row.totalLiters += c.liters;
      const ct = colTotals[pk]!;
      ct.baht += c.baht;
      ct.liters += c.liters;
      ct.mBaht += c.mBaht;
      ct.mLit += c.mLit;
      ct.eBaht += c.eBaht;
      ct.eLit += c.eLit;
      ct.anomaly += c.anomaly;
      anomalyTotal += c.anomaly;
    }
    grandBaht += row.totalBaht;
    grandLiters += row.totalLiters;
  }

  return {
    mode,
    periodKeys,
    periodLabels,
    rows,
    colTotals,
    grandBaht,
    grandLiters,
    hasShift: shiftGrand > 0.5,
    anomalyTotal,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
  };
}

// ── โหมดรายกะ: 1 แถว = 1 กะของ 1 วัน ──
async function fetchShiftModeReport(
  admin: Admin,
  orgId: string,
  q: FlowcoReportQuery,
  steId: number | null,
  nameOfFrom: (
    m: Map<number, { id: string; name: string }>,
  ) => (ste: number) => string,
): Promise<FlowcoReport> {
  const [shiftSales, shiftPays, steMap] = await Promise.all([
    fetchFlowcoShiftRows(admin, q.dateFrom, q.dateTo, steId),
    fetchFlowcoShiftPaymentRows(admin, q.dateFrom, q.dateTo, steId),
    resolveSteToBranch(admin, orgId),
  ]);
  const nameOf = nameOfFrom(steMap);
  const inScope = (ste: number) =>
    SEED_STE.has(ste) && (!steId || ste === steId);

  const rowMap = new Map<string, FlowcoReportRow>();
  const shiftOf = new Map<string, number>(); // key → shiftNo (สำหรับ sort)
  const getRow = (date: string, shiftNo: number): FlowcoReportRow => {
    const key = `${date}__s${shiftNo}`;
    let r = rowMap.get(key);
    if (!r) {
      r = {
        key,
        label: `${dayLabel(date)} · ${shiftLabel(shiftNo)}`,
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
      shiftOf.set(key, shiftNo);
    }
    return r;
  };

  for (const s of shiftSales) {
    if (!inScope(s.steId)) continue;
    const r = getRow(s.reportDate, s.shiftNo);
    r.totalSales += s.baht;
    r.liters += s.liters;
  }
  for (const p of shiftPays) {
    if (!inScope(p.steId)) continue;
    if (p.amt < 0 || p.amt > 5_000_000) continue; // กันเพี้ยน
    const r = getRow(p.reportDate, p.shiftNo);
    const b = payBucket(p.groupCode);
    if (b === "cash") r.cash += p.amt;
    else if (b === "card") r.card += p.amt;
    else if (b === "credit") r.credit += p.amt;
    else if (b === "transfer") r.transfer += p.amt;
  }

  // เรียง: วันใหม่ก่อน → กะเช้าก่อนกะดึก
  const rows = [...rowMap.values()].sort((x, y) => {
    const dx = x.key.slice(0, 10),
      dy = y.key.slice(0, 10);
    if (dx !== dy) return dx < dy ? 1 : -1;
    return (shiftOf.get(x.key) ?? 0) - (shiftOf.get(y.key) ?? 0);
  });

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
  }

  const branches = [...FLOWCO_STATIONS]
    .sort((a, b) => a.steId - b.steId)
    .map((s) => ({ steId: s.steId, name: nameOf(s.steId) }));

  return {
    rows,
    branches,
    totals,
    fuelCols: [],
    hasShift: false,
    anomalyTotal: 0,
    mode: "shift",
    steId,
    branchName: steId ? nameOf(steId) : null,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
  };
}
