// CashHub ⛽ ปั๊ม 62 — FULL-grid raw parser for the "ตารางเต็มเหมือนชีต" view.
//
// Unlike fuel-parser.ts (positional, maps a fixed set of fields and only reads cleanly
// on the recent layout), this reads EVERY column verbatim by anchoring on the header
// TEXT — so it reproduces the sheet 1:1 across the 4 column layouts the gas-station's
// workbook drifted through (2567→2569). It captures the cell values as-is (no math), so
// fidelity is guaranteed by construction. Validated: every month's day-count matches the
// sheet and the spot-checked cells equal the sheet (see scripts/extract_pump62_raw.js).

import * as XLSX from "xlsx";

export interface FuelSheetHeader {
  c: number; // source column index (1-based offset from col0=date)
  group: string; // bank-account group, e.g. "กสิกร 2345 (K+)" ("" = ungrouped)
  name: string; // display name (metric · timing)
}

export type FuelCell = number | string | null;

export interface FuelSheetRow {
  date: string; // YYYY-MM-DD
  day: number;
  shift: string; // เช้า / ค่ำ / สิ้นเดือน / ดึก / ...
  cells: FuelCell[]; // one per header, in sheet order
}

export interface FuelSheetMonth {
  periodKey: string; // 'YYYY-MM'
  year: number;
  month: number; // 1-12
  label: string; // 'พ.ค. 2569'
  sheetTab: string;
  headers: FuelSheetHeader[];
  rows: FuelSheetRow[];
  ncol: number;
  daysPresent: number;
  expectedDays: number;
  missingDays: number[];
}

const THAI_MONTHS: Record<string, number> = {
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6,
  "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
};
const THAI_FULL = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

const FUEL_TAB_NEEDLE = "ยอดขายปั้ม62";
const SKIP_NEEDLES = ["ยอดแจกน้ำ", "แจกน้ำ", "น้ำมันเครื่อง", "ค่าน้ำ", "ทำเบิก"];
const NOT_SHIFT = /รวม|สรุป|vat|มูลค่า|ภาษี|ก่อนvat/i;
const BANK_RE = /TTBYM|กสิกร|ทหารไทย/;
const RESET_RE = /วัดตวง|พนักงาน|ส่วนต่างทั้งหมด|ส่วนต่างเครดิต|หมายเหตุ|ทั้งสองบัญ|เทสหัวจ่าย|เทสหัว/;

function strip(s: unknown): string {
  return s == null ? "" : String(s).replace(/\s+/g, "");
}
function numOrNull(x: unknown): number | null {
  if (x === "" || x == null) return null;
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}
function isFuelTab(name: string): boolean {
  const s = strip(name);
  if (!s.includes(FUEL_TAB_NEEDLE)) return false;
  if (name.trimStart().startsWith("สำเนา")) return false;
  return !SKIP_NEEDLES.some((nd) => s.includes(strip(nd)));
}
function tabMonth(name: string): { month: number; yy: number | null } | null {
  const m = name.match(
    /(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2})?/,
  );
  if (!m) return null;
  return { month: THAI_MONTHS[m[1]!]!, yy: m[2] ? parseInt(m[2], 10) : null };
}
function bankShort(label: unknown): string {
  const s = strip(label);
  if (s.includes("TTBYM")) return "TTB-YM 0649";
  if (s.includes("กสิกร")) return s.includes("2345") ? "กสิกร 2345 (K+)" : "กสิกร 011-283-184-3";
  if (s.includes("ทหารไทย")) return "ทหารไทย 609";
  return "";
}

type Grid = (string | number | null)[][];

function buildMonth(
  ws: XLSX.WorkSheet,
  name: string,
  year: number,
  month: number,
): FuelSheetMonth {
  const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1, defval: null, raw: true,
  }) as Grid;
  const h1 = grid[1] ?? [], h2 = grid[2] ?? [], h3 = grid[3] ?? [];
  const daysInMonth = new Date(year, month, 0).getDate();

  let maxC = 0;
  for (let c = 0; c < 60; c++) {
    if ([h1[c], h2[c], h3[c]].some((x) => x != null && String(x).trim() !== "")) maxC = c;
  }

  // headers with bank-group carry-forward
  const headers: FuelSheetHeader[] = [];
  let group = "";
  for (let c = 1; c <= maxC; c++) {
    const labels = [h1[c], h2[c], h3[c]].map((x) => (x == null ? "" : String(x).trim()));
    const joined = strip(labels.join(""));
    if (BANK_RE.test(strip(h1[c]))) group = bankShort(h1[c]);
    else if (RESET_RE.test(joined) || /ยอดขาย$/.test(strip(labels[0]))) group = "";
    const detail = labels.filter(Boolean).filter((d) => !BANK_RE.test(strip(d)));
    let nm = detail.join(" · ") || (group ? "" : labels.find(Boolean) ?? `c${c}`);
    if (c === 1) nm = "กะ";
    else if (joined.includes(strip("ปริมาณลิตร"))) nm = "ปริมาณลิตร";
    else nm = nm.replace(/^(ค่ำ|เช้า)\s*·\s*/, "");
    headers.push({ c, group, name: nm });
  }

  // sale/liters probe columns (header-driven) to gate real data rows
  const findCol = (needle: string, rows: number[]): number => {
    for (const r of rows) {
      const row = grid[r] ?? [];
      for (let c = 0; c < row.length; c++) if (strip(row[c]).includes(strip(needle))) return c;
    }
    return -1;
  };
  const litersCol = findCol("ปริมาณลิตร", [2]);
  let totalCol = findCol("ยอดขาย", [2]);
  if (totalCol === litersCol) totalCol = -1;
  const fuelCol = findCol("ยอดขายน้ำมัน", [2, 1]);

  const ref = ws["!ref"];
  const dayText: (string | null)[] = [];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })] as XLSX.CellObject | undefined;
      dayText[r] = cell?.w != null ? String(cell.w).trim() : cell?.v != null ? String(cell.v).trim() : null;
    }
  }

  const rows: FuelSheetRow[] = [];
  let curDay: number | null = null;
  for (let i = 4; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const shiftTH = r[1] == null ? "" : String(r[1]).trim();
    if (shiftTH === "" || NOT_SHIFT.test(strip(shiftTH))) continue;
    const fuel = fuelCol >= 0 ? numOrNull(r[fuelCol]) : null;
    const tot =
      totalCol >= 0
        ? numOrNull(r[totalCol])
        : fuel != null
          ? fuel + (numOrNull(r[fuelCol + 1]) ?? 0)
          : null;
    if (tot == null || tot <= 0) continue;

    const d = parseInt(dayText[i] ?? "", 10);
    if (!Number.isNaN(d) && d >= 1 && d <= 31) curDay = d;
    else if (shiftTH === "เช้า" && curDay != null) curDay += 1;
    if (curDay == null) continue;

    const dayClamped = Math.min(curDay, daysInMonth);
    const cells: FuelCell[] = [];
    for (let c = 1; c <= maxC; c++) {
      const v = r[c];
      cells.push(
        typeof v === "number" ? Math.round(v * 100) / 100 : v == null ? null : String(v).trim() || null,
      );
    }
    rows.push({
      date: `${year}-${String(month).padStart(2, "0")}-${String(dayClamped).padStart(2, "0")}`,
      day: dayClamped,
      shift: shiftTH,
      cells,
    });
  }

  const present = new Set(rows.map((r) => r.day));
  // Only flag INTERNAL gaps (a missing day BEFORE the last day that has data). The
  // not-yet-entered tail of the current month must not read as "ขาดวัน".
  const maxPresent = rows.length ? Math.max(...rows.map((r) => r.day)) : 0;
  const missing: number[] = [];
  for (let dd = 1; dd <= maxPresent; dd++) if (!present.has(dd)) missing.push(dd);

  return {
    periodKey: `${year}-${String(month).padStart(2, "0")}`,
    year, month,
    label: `${THAI_FULL[month - 1]} ${year + 543}`,
    sheetTab: name,
    headers, rows, ncol: maxC,
    daysPresent: present.size,
    expectedDays: daysInMonth,
    missingDays: missing,
  };
}

/** Parse EVERY ยอดขายปั้ม62 tab into a faithful full-grid per month (newest first). */
export function parseFuelSheetMonths(buf: Buffer): FuelSheetMonth[] {
  const wb = XLSX.read(buf, { type: "buffer", cellNF: true, sheetStubs: true });
  const order = wb.SheetNames.filter(isFuelTab);

  // resolve year-less tabs ("พ.ย.ยอดขายปั้ม62") from the previous dated tab (file is
  // ordered newest→oldest, so the year carries down a descending block).
  let lastYear: number | null = null;
  const months: FuelSheetMonth[] = [];
  for (const name of order) {
    const tm = tabMonth(name);
    if (!tm) continue;
    const year: number | null = tm.yy == null ? lastYear : 2500 + tm.yy - 543;
    lastYear = year;
    if (year == null) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    months.push(buildMonth(ws, name, year, tm.month));
  }
  months.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  return months;
}
