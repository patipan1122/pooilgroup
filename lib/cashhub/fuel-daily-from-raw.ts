// CashHub ⛽ ปั๊ม 62 — promote a stored FULL-grid month (cashhub_fuel_sheet_month,
// header-driven, correct on every layout) into reconcile rows (cashhub_fuel_daily).
//
// This lets the CEO pick ANY month to pull into the กระทบยอด view and have it be
// CORRECT — the legacy positional parser (fuel-parser.ts) only reads the recent layout
// cleanly. We map by HEADER NAME from the already-validated raw grid, so no re-fetch and
// no DB change. Like the legacy daily path, only เช้า/ค่ำ shifts are promoted (the daily
// table's shift CHECK is morning/evening; the end-of-month special shifts stay in the
// full table).

import type { FuelShiftRow, FuelBankAccount } from "./fuel-parser";
import { classifyRows, type FuelRecon } from "./fuel-validator";

export interface StoredHeader {
  c: number;
  group: string;
  name: string;
}
export interface StoredRow {
  date: string;
  day: number;
  shift: string;
  cells: (number | string | null)[];
}
export interface StoredMonth {
  period_key: string;
  year: number;
  month: number;
  sheet_tab: string;
  headers: StoredHeader[];
  rows: StoredRow[];
}

const strip = (s: string) => s.replace(/\s+/g, "");
function num(x: number | string | null | undefined): number | null {
  if (x === "" || x == null) return null;
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}
function sumN(...xs: (number | null)[]): number | null {
  const p = xs.filter((x): x is number => x != null);
  return p.length ? p.reduce((a, b) => a + b, 0) : null;
}

interface ColMap {
  liters: number; total: number; fuel: number; oil: number;
  cashSubmit: number; cashIn: number; cashDiff: number; credit: number;
  grandBoth: number; measure: number; staff: number; creditDiff: number; totalDiff: number; note: number;
  ttb0649: number; ksk: number; ttb609: number; // block start (QR-เช้า col), -1 if absent
}

/** Resolve the column index of each reconcile field by HEADER NAME for this month. */
function resolveCols(headers: StoredHeader[]): ColMap {
  const find = (pred: (h: StoredHeader) => boolean) => headers.findIndex(pred);
  const nameHas = (h: StoredHeader, s: string) => strip(h.name).includes(strip(s));
  const ungrouped = (h: StoredHeader) => h.group === "";
  const blockStart = (needle: string) => find((h) => h.group.includes(needle));

  let total = find((h) => ungrouped(h) && strip(h.name) === strip("ยอดขาย"));
  const liters = find((h) => nameHas(h, "ปริมาณลิตร"));
  if (total === liters) total = -1;

  return {
    liters,
    total,
    fuel: find((h) => nameHas(h, "ยอดขายน้ำมัน")),
    oil: find((h) => nameHas(h, "ขายน้ำมันเค")),
    cashSubmit: find((h) => ungrouped(h) && nameHas(h, "ยอดส่งเงิน")),
    cashIn: find((h) => ungrouped(h) && nameHas(h, "ยอดเงินเข้า")),
    cashDiff: find((h) => ungrouped(h) && nameHas(h, "ส่วนต่าง") && (nameHas(h, "สด") || nameHas(h, "เง"))),
    credit: find((h) => nameHas(h, "เงินเชื่อ")),
    grandBoth: find((h) => nameHas(h, "ทั้งสองบัญ")),
    measure: find((h) => nameHas(h, "วัดตวง") || nameHas(h, "เทสหัว")),
    staff: find((h) => nameHas(h, "พนักงาน")),
    creditDiff: find((h) => nameHas(h, "ส่วนต่างเครดิต")),
    totalDiff: find((h) => nameHas(h, "ส่วนต่างทั้งหมด")),
    note: find((h) => nameHas(h, "หมายเหตุ")),
    ttb0649: blockStart("TTB-YM"),
    ksk: blockStart("กสิกร"),
    ttb609: blockStart("ทหารไทย"),
  };
}

function bankAt(cells: (number | string | null)[], start: number): FuelBankAccount {
  if (start < 0) return { qrAM: null, qrLate: null, cardAM: null, cardLate: null };
  return {
    qrAM: num(cells[start]),
    qrLate: num(cells[start + 1]),
    cardAM: num(cells[start + 2]),
    cardLate: num(cells[start + 3]),
  };
}

/** Map a stored full-grid month → classified reconcile rows (เช้า/ค่ำ only). */
export function mapStoredMonthToDaily(
  m: StoredMonth,
): { row: FuelShiftRow; recon: FuelRecon }[] {
  const col = resolveCols(m.headers);
  const rows: FuelShiftRow[] = [];

  for (const r of m.rows) {
    const shift = r.shift === "เช้า" ? "morning" : r.shift === "ค่ำ" ? "evening" : null;
    if (!shift) continue; // skip สิ้นเดือน/ดึก/กะสิ้นเดือน (daily table = morning/evening)
    const cells = r.cells;
    const fuel = col.fuel >= 0 ? num(cells[col.fuel]) : null;
    const oil = col.oil >= 0 ? num(cells[col.oil]) : null;
    const total = col.total >= 0 ? num(cells[col.total]) : sumN(fuel, oil);

    const ttb0649 = bankAt(cells, col.ttb0649);
    const ksk2345 = bankAt(cells, col.ksk);
    const ttb609 = bankAt(cells, col.ttb609);
    const transferTotal = sumN(
      ttb0649.qrAM, ttb0649.qrLate, ksk2345.qrAM, ksk2345.qrLate, ttb609.qrAM, ttb609.qrLate,
    );
    const cardTotal = sumN(
      ttb0649.cardAM, ttb0649.cardLate, ksk2345.cardAM, ksk2345.cardLate, ttb609.cardAM, ttb609.cardLate,
    );
    const staffRaw = col.staff >= 0 ? cells[col.staff] : null;
    const noteRaw =
      col.note >= 0 && cells[col.note] != null ? String(cells[col.note]).trim() || null : null;

    rows.push({
      reportDate: r.date,
      day: r.day,
      shift,
      shiftTH: r.shift,
      sheetTab: m.sheet_tab,
      liters: col.liters >= 0 ? num(cells[col.liters]) : null,
      totalSales: total,
      fuelSales: fuel,
      engineOilSales: oil,
      cashSubmitted: col.cashSubmit >= 0 ? num(cells[col.cashSubmit]) : null,
      cashBanked: col.cashIn >= 0 ? num(cells[col.cashIn]) : null,
      cashDiffSheet: col.cashDiff >= 0 ? num(cells[col.cashDiff]) : null,
      credit: col.credit >= 0 ? num(cells[col.credit]) : null,
      creditDiff: col.creditDiff >= 0 ? num(cells[col.creditDiff]) : null,
      totalDiff: col.totalDiff >= 0 ? num(cells[col.totalDiff]) : null,
      ttb0649,
      ksk2345,
      ttb609,
      grandTotalBoth: col.grandBoth >= 0 ? num(cells[col.grandBoth]) : null,
      transferTotal,
      cardTotal,
      measure: col.measure >= 0 ? num(cells[col.measure]) : null,
      staffName: staffRaw != null ? String(staffRaw).replace(/เเ/g, "แ").trim() || null : null,
      note: noteRaw,
      rawRow: cells.slice(0, 43),
    });
  }

  const recon = classifyRows(rows);

  // Old layouts (2567) have NO "เงินเข้าบัญชี" column → cashBanked is null for the whole
  // month. That is not a pending deposit (the sheet simply didn't track it then), so don't
  // flood the view with false 🟡 — downgrade those pending rows to ok.
  const hasCashInCol = col.cashIn >= 0;
  if (!hasCashInCol) {
    for (const rc of recon) {
      if (rc.reconStatus === "pending_deposit") {
        rc.reconStatus = "ok";
        rc.reasons = rc.reasons.filter((s) => !s.includes("ยังไม่เข้าบัญชี"));
      }
    }
  }

  return rows.map((row, i) => ({ row, recon: recon[i]! }));
}
