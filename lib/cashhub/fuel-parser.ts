// CashHub ⛽ ปั๊มน้ำมัน 62 — workbook parser.
//
// Parses the gas-station's hand-filled monthly Google Sheet (.xlsx) into clean
// per-shift rows. The column map + carry-forward + stop rules below were VALIDATED
// against the real file: the summed monthly total reproduced the sheet's own
// summary row byte-for-byte (มิ.ย.69 = ฿2,624,408.10, พ.ค.69 = ฿6,679,826.10).
//
// Shape: 1 month = 1 tab (named "<thai-month><yy>ยอดขายปั้ม62"). Header = 3 rows.
// 1 DAY = 2 physical rows (col1 = เช้า morning / ค่ำ evening); the day number lives
// ONLY on the morning row (col0) and is read from the FORMATTED value (.w), not the
// raw serial (.v). The real calendar date is built from the tab's month + year.

import * as XLSX from "xlsx";

export type FuelShift = "morning" | "evening";

export interface FuelBankAccount {
  qrAM: number | null;
  qrLate: number | null;
  cardAM: number | null;
  cardLate: number | null;
}

export interface FuelShiftRow {
  reportDate: string; // YYYY-MM-DD
  day: number;
  shift: FuelShift;
  shiftTH: string;
  sheetTab: string;

  liters: number | null;
  totalSales: number | null;
  fuelSales: number | null;
  engineOilSales: number | null;

  cashSubmitted: number | null;
  cashBanked: number | null; // null = ยังไม่นำฝาก
  cashDiffSheet: number | null; // col8 as-is in the sheet
  credit: number | null;
  creditDiff: number | null;
  totalDiff: number | null;

  // Per-account breakdown (cols 10-36)
  ttb0649: FuelBankAccount; // TTB YM 0649
  ksk2345: FuelBankAccount; // กสิกรไทย 2345
  ttb609: FuelBankAccount; // ทหารไทย TTB 609-2-58313-4
  grandTotalBoth: number | null; // col25

  transferTotal: number | null; // Σ QR across 3 accounts
  cardTotal: number | null; // Σ card across 3 accounts

  measure: number | null;
  staffName: string | null;
  note: string | null;

  rawRow: (string | number | null)[]; // full 0..N cells verbatim
}

export interface FuelMonth {
  sheetTab: string;
  monthLabel: string; // e.g. "มิ.ย. 2026"
  year: number;
  month: number; // 1-12
  dayCount: number;
  rowCount: number; // shift rows
  parsedTotalSales: number; // Σ of our per-shift totalSales
  parsedTotalLiters: number;
  sheetSummaryTotalSales: number | null; // the sheet's own total row (for cross-check)
  sheetSummaryTotalLiters: number | null;
  // true when |parsed − sheet| ≤ ฿1 (only meaningful when sheet summary present)
  summaryMatches: boolean | null;
}

export interface FuelParseResult {
  rows: FuelShiftRow[];
  months: FuelMonth[];
  tabsParsed: string[];
  tabsSkipped: string[];
  errors: string[];
  warnings: string[];
}

// ---- column map (0-indexed, LOCKED) -------------------------------------------------
const C = {
  day: 0,
  shift: 1,
  liters: 2,
  totalSales: 3,
  fuelSales: 4,
  engineOil: 5,
  cashSubmitted: 6,
  cashBanked: 7,
  cashDiff: 8,
  credit: 9,
  // TTB YM 0649
  ttb0649_qr_am: 10,
  ttb0649_qr_late: 11,
  ttb0649_card_am: 12,
  ttb0649_card_late: 13,
  // Kasikorn 2345
  ksk_qr_am: 14,
  ksk_qr_late: 15,
  ksk_card_am: 16,
  ksk_card_late: 17,
  grandTotalBoth: 25,
  // ทหารไทย TTB 609
  ttb609_qr_am: 26,
  ttb609_qr_late: 27,
  ttb609_card_am: 28,
  ttb609_card_late: 29,
  measure: 38,
  staff: 39,
  creditDiff: 40,
  totalDiff: 41,
  note: 42,
} as const;

const THAI_MONTHS: Record<string, number> = {
  "ม.ค.": 1,
  "ก.พ.": 2,
  "มี.ค.": 3,
  "เม.ย.": 4,
  "พ.ค.": 5,
  "มิ.ย.": 6,
  "ก.ค.": 7,
  "ส.ค.": 8,
  "ก.ย.": 9,
  "ต.ค.": 10,
  "พ.ย.": 11,
  "ธ.ค.": 12,
};
const THAI_MONTH_FULL = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const FUEL_TAB_NEEDLE = "ยอดขายปั้ม62";
const SKIP_PREFIXES = ["สำเนาของ", "สำเนา"];
const SKIP_NEEDLES = ["ยอดแจกน้ำ", "แจกน้ำ", "น้ำมันเครื่อง", "ค่าน้ำ", "ทำเบิก"];

function stripWs(s: string): string {
  return (s || "").replace(/\s+/g, "");
}

function num(x: unknown): number | null {
  if (x === "" || x === null || x === undefined) return null;
  const n =
    typeof x === "number" ? x : parseFloat(String(x).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

function normalizeStaff(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/เเ/g, "แ").trim(); // duplicated SARA-E → แ
  return s.length ? s : null;
}

// "มิ.ย.69ยอดขายปั้ม62" → { month:6, year:2026 }. Year-less tabs return null.
function tabMeta(name: string): { month: number; year: number } | null {
  const m = name.match(
    /(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2})/,
  );
  if (!m) return null;
  const month = THAI_MONTHS[m[1]!];
  const yy = parseInt(m[2]!, 10);
  const year = 2500 + yy - 543; // 69 → 2569 BE → 2026 CE
  if (!month || year < 2018 || year > 2100) return null;
  return { month, year };
}

function isFuelTab(name: string): boolean {
  const stripped = stripWs(name);
  if (!stripped.includes(FUEL_TAB_NEEDLE)) return false;
  if (SKIP_PREFIXES.some((p) => name.trimStart().startsWith(p))) return false;
  if (SKIP_NEEDLES.some((n) => stripped.includes(stripWs(n)))) return false;
  return true;
}

function bank(
  row: (string | number | null)[],
  qrAm: number,
  qrLate: number,
  cardAm: number,
  cardLate: number,
): FuelBankAccount {
  return {
    qrAM: num(row[qrAm]),
    qrLate: num(row[qrLate]),
    cardAM: num(row[cardAm]),
    cardLate: num(row[cardLate]),
  };
}

function sumNullable(...xs: (number | null)[]): number | null {
  const present = xs.filter((x): x is number => x !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

// Convert one worksheet to an array-of-arrays grid using the FORMATTED value for the
// day column (.w) and raw values elsewhere. SheetJS sheet_to_json(header:1) gives raw
// values; we override col0 with the formatted day from the cell's .w.
function sheetToGrid(ws: XLSX.WorkSheet): {
  grid: (string | number | null)[][];
  dayText: (string | null)[];
} {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });
  // pull the formatted .w for col0 of each row (the day label "1","2",...)
  const ref = ws["!ref"];
  const dayText: (string | null)[] = [];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      dayText[r - range.s.r] =
        cell && cell.w != null
          ? String(cell.w).trim()
          : cell && cell.v != null
            ? String(cell.v).trim()
            : null;
    }
  }
  return { grid: rows, dayText };
}

function parseTab(
  ws: XLSX.WorkSheet,
  tabName: string,
  warnings: string[],
): { rows: FuelShiftRow[]; month: FuelMonth } | null {
  const meta = tabMeta(tabName);
  if (!meta) {
    warnings.push(`ข้ามแท็บไม่มีปี/เดือนชัดเจน: "${tabName}"`);
    return null;
  }
  const { grid, dayText } = sheetToGrid(ws);
  const mm = String(meta.month).padStart(2, "0");

  const rows: FuelShiftRow[] = [];
  let curDay: number | null = null;
  let lastShift: FuelShift | null = null;
  // candidate monthly-total cells (non-shift rows below the data). The real grand
  // total is the one closest to our own summed total — picking the FIRST ≥100k row
  // wrongly grabbed a stray sub-total in some months.
  const summaryCandidates: { sales: number; liters: number | null }[] = [];
  let sawData = false;

  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const shiftCell = r[C.shift];
    const shiftTH = shiftCell == null ? "" : String(shiftCell).trim();
    const total = num(r[C.totalSales]);

    const isMorning = shiftTH === "เช้า";
    const isEvening = shiftTH === "ค่ำ";

    // A data row = shift cell is เช้า/ค่ำ AND total_sales is a real number.
    // (Empty trailing rows have cashDiff='0.0' but total_sales=null → excluded.)
    if ((isMorning || isEvening) && total !== null) {
      sawData = true;
      if (isMorning) {
        const dt = dayText[i];
        const d = dt != null ? parseInt(dt, 10) : NaN;
        if (!Number.isNaN(d)) curDay = d;
      }
      // pairing sanity: two เช้า in a row (no ค่ำ between) → drift warning
      if (isMorning && lastShift === "morning") {
        warnings.push(
          `โครงสร้างผิดปกติ (เช้าซ้อนเช้า) แท็บ "${tabName}" แถว ${i + 1}`,
        );
      }
      lastShift = isMorning ? "morning" : "evening";
      if (curDay == null) continue; // no day anchor yet — skip defensively

      const shift: FuelShift = isMorning ? "morning" : "evening";
      const ttb0649 = bank(
        r,
        C.ttb0649_qr_am,
        C.ttb0649_qr_late,
        C.ttb0649_card_am,
        C.ttb0649_card_late,
      );
      const ksk2345 = bank(
        r,
        C.ksk_qr_am,
        C.ksk_qr_late,
        C.ksk_card_am,
        C.ksk_card_late,
      );
      const ttb609 = bank(
        r,
        C.ttb609_qr_am,
        C.ttb609_qr_late,
        C.ttb609_card_am,
        C.ttb609_card_late,
      );
      const transferTotal = sumNullable(
        ttb0649.qrAM,
        ttb0649.qrLate,
        ksk2345.qrAM,
        ksk2345.qrLate,
        ttb609.qrAM,
        ttb609.qrLate,
      );
      const cardTotal = sumNullable(
        ttb0649.cardAM,
        ttb0649.cardLate,
        ksk2345.cardAM,
        ksk2345.cardLate,
        ttb609.cardAM,
        ttb609.cardLate,
      );

      rows.push({
        reportDate: `${meta.year}-${mm}-${String(curDay).padStart(2, "0")}`,
        day: curDay,
        shift,
        shiftTH,
        sheetTab: tabName,
        liters: num(r[C.liters]),
        totalSales: total,
        fuelSales: num(r[C.fuelSales]),
        engineOilSales: num(r[C.engineOil]),
        cashSubmitted: num(r[C.cashSubmitted]),
        cashBanked: num(r[C.cashBanked]),
        cashDiffSheet: num(r[C.cashDiff]),
        credit: num(r[C.credit]),
        creditDiff: num(r[C.creditDiff]),
        totalDiff: num(r[C.totalDiff]),
        ttb0649,
        ksk2345,
        ttb609,
        grandTotalBoth: num(r[C.grandTotalBoth]),
        transferTotal,
        cardTotal,
        measure: num(r[C.measure]),
        staffName: normalizeStaff(r[C.staff]),
        note: r[C.note] != null ? String(r[C.note]).trim() || null : null,
        rawRow: r.slice(0, 43),
      });
      continue;
    }

    // After we've seen day data, collect candidate monthly-total cells (non-shift rows).
    if (sawData && !isMorning && !isEvening) {
      const t = num(r[C.totalSales]);
      if (t != null && t >= 1000) {
        summaryCandidates.push({ sales: t, liters: num(r[C.liters]) });
      }
    }
  }

  const parsedTotalSales = rows.reduce((a, r) => a + (r.totalSales ?? 0), 0);
  const parsedTotalLiters = rows.reduce((a, r) => a + (r.liters ?? 0), 0);
  const days = new Set(rows.map((r) => r.day));

  // Pick the candidate closest to our summed total = the sheet's own grand total.
  let sheetSummarySales: number | null = null;
  let sheetSummaryLiters: number | null = null;
  if (summaryCandidates.length > 0) {
    let best = summaryCandidates[0]!;
    for (const c of summaryCandidates) {
      if (
        Math.abs(c.sales - parsedTotalSales) <
        Math.abs(best.sales - parsedTotalSales)
      ) {
        best = c;
      }
    }
    sheetSummarySales = best.sales;
    sheetSummaryLiters = best.liters;
  }

  const summaryMatches =
    sheetSummarySales == null
      ? null
      : Math.abs(Math.round(parsedTotalSales * 100) - Math.round(sheetSummarySales * 100)) <= 100;

  const month: FuelMonth = {
    sheetTab: tabName,
    monthLabel: `${THAI_MONTH_FULL[meta.month - 1]} ${meta.year}`,
    year: meta.year,
    month: meta.month,
    dayCount: days.size,
    rowCount: rows.length,
    parsedTotalSales,
    parsedTotalLiters,
    sheetSummaryTotalSales: sheetSummarySales,
    sheetSummaryTotalLiters: sheetSummaryLiters,
    summaryMatches,
  };

  if (summaryMatches === false) {
    warnings.push(
      `ยอดรวมที่เราคำนวณ (${parsedTotalSales.toLocaleString()}) ไม่ตรงยอดท้ายชีต (${sheetSummarySales?.toLocaleString()}) แท็บ "${tabName}"`,
    );
  }

  return { rows, month };
}

/**
 * Parse the whole workbook. `onlyMonths` (set of "YYYY-MM") optionally restricts to
 * specific months — used so a "ดึง 2 เดือนล่าสุด" pull doesn't process all 30 tabs.
 */
export function parseFuelWorkbook(
  buf: ArrayBuffer | Buffer,
  opts: { onlyMonths?: Set<string> } = {},
): FuelParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: FuelShiftRow[] = [];
  const months: FuelMonth[] = [];
  const tabsParsed: string[] = [];
  const tabsSkipped: string[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  } catch (e) {
    return {
      rows: [],
      months: [],
      tabsParsed: [],
      tabsSkipped: [],
      errors: [`อ่านไฟล์ Excel ไม่สำเร็จ: ${(e as Error).message}`],
      warnings: [],
    };
  }

  const fuelTabs = wb.SheetNames.filter(isFuelTab);
  for (const name of wb.SheetNames) {
    if (!fuelTabs.includes(name)) tabsSkipped.push(name);
  }
  if (fuelTabs.length === 0) {
    errors.push("ไม่พบแท็บยอดขายปั๊ม (ยอดขายปั้ม62) ในไฟล์นี้");
    return { rows, months, tabsParsed, tabsSkipped, errors, warnings };
  }

  for (const name of fuelTabs) {
    const meta = tabMeta(name);
    if (opts.onlyMonths && meta) {
      const key = `${meta.year}-${String(meta.month).padStart(2, "0")}`;
      if (!opts.onlyMonths.has(key)) {
        tabsSkipped.push(name);
        continue;
      }
    }
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const parsed = parseTab(ws, name, warnings);
    if (!parsed) {
      tabsSkipped.push(name);
      continue;
    }
    rows.push(...parsed.rows);
    months.push(parsed.month);
    tabsParsed.push(name);
  }

  // newest month first
  months.sort((a, b) => b.year - a.year || b.month - a.month);

  return { rows, months, tabsParsed, tabsSkipped, errors, warnings };
}

/** The two most recent months present in the workbook (by tab metadata). */
export function latestMonthKeys(wbNames: string[], n = 2): Set<string> {
  const keys = wbNames
    .filter(isFuelTab)
    .map((name) => tabMeta(name))
    .filter((m): m is { month: number; year: number } => m !== null)
    .map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);
  const uniq = Array.from(new Set(keys)).sort().reverse();
  return new Set(uniq.slice(0, n));
}

export { isFuelTab, tabMeta };
