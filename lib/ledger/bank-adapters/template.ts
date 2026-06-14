// Universal LedgerLine template adapter — "PEAK-style" generic import.
// Lets any account (incl. banks with no dedicated parser: BAAC/GSB/KTB/TrueMoney/etc.)
// be reconciled by filling a simple spreadsheet the user downloads from the app.
//
// Expected columns (matched by HEADER NAME, order-independent, extras ignored):
//   วันที่            → txnDate   (required)   — accepts DD/MM/YYYY, D/M/YYYY, YYYY-MM-DD, Buddhist year auto-converted
//   เงินเข้า          → credit    (deposit)    — fill this OR เงินออก, exactly one per row
//   เงินออก          → debit     (withdrawal)
//   รายละเอียด/หมายเหตุ → description (optional)
//   คู่ค้า/อ้างอิง     → ref1      (optional)
//
// Source xlsx is converted to CSV upstream (fileToContent in _actions.ts), so this
// adapter — like every bank adapter — receives plain CSV text.

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseCSVLines, parseAmountSatang } from "./types";

export const TEMPLATE_FORMAT = "TEMPLATE_v1";

// Header synonyms → canonical field. Lowercased + trimmed before matching.
const HEADER_MAP: { field: "date" | "credit" | "debit" | "desc" | "ref"; keys: string[] }[] = [
  { field: "date",   keys: ["วันที่", "date", "วัน"] },
  { field: "credit", keys: ["เงินเข้า", "รับเข้า", "เครดิต", "credit", "deposit", "รับ"] },
  { field: "debit",  keys: ["เงินออก", "จ่ายออก", "เดบิต", "debit", "withdraw", "จ่าย"] },
  { field: "desc",   keys: ["รายละเอียด", "หมายเหตุ", "คำอธิบาย", "description", "note", "memo"] },
  { field: "ref",    keys: ["คู่ค้า", "อ้างอิง", "ref", "reference", "ผู้ติดต่อ"] },
];

function matchHeader(cell: string): "date" | "credit" | "debit" | "desc" | "ref" | null {
  const c = cell.trim().toLowerCase().replace(/\s+/g, "");
  for (const { field, keys } of HEADER_MAP) {
    if (keys.some((k) => c.includes(k.toLowerCase().replace(/\s+/g, "")))) return field;
  }
  return null;
}

/** Flexible date parse: ISO, D/M/Y (or - .), Buddhist year (>2400 → −543). Returns 'YYYY-MM-DD' or null. */
function parseTemplateDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  // ISO: YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    let y = +m[1]; const mo = +m[2], d = +m[3];
    if (y > 2400) y -= 543;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // D/M/Y (day-first, Thai convention)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const d = +m[1], mo = +m[2]; let y = +m[3];
    if (y < 100) y += 2000;
    if (y > 2400) y -= 543;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

export const templateAdapter: BankAdapter = {
  bankCode: "OTHER",
  formatVersion: TEMPLATE_FORMAT,

  // Recognize our template: a header row that has วันที่ AND at least one amount column.
  detect(content: string): boolean {
    const lines = parseCSVLines(content);
    for (const cols of lines.slice(0, 5)) {
      const fields = cols.map(matchHeader);
      const hasDate = fields.includes("date");
      const hasAmount = fields.includes("credit") || fields.includes("debit");
      if (hasDate && hasAmount) return true;
    }
    return false;
  },

  parse(content: string): ParseResult {
    const lines = parseCSVLines(content);
    const errors: string[] = [];

    // Locate header row + column index → field mapping.
    let headerIdx = -1;
    let colMap: Record<number, "date" | "credit" | "debit" | "desc" | "ref"> = {};
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const fields = lines[i].map(matchHeader);
      if (fields.includes("date") && (fields.includes("credit") || fields.includes("debit"))) {
        headerIdx = i;
        fields.forEach((f, idx) => { if (f) colMap[idx] = f; });
        break;
      }
    }
    if (headerIdx === -1) {
      return { bankCode: "OTHER", formatVersion: TEMPLATE_FORMAT, accountNo: "", rows: [], periodStart: "", periodEnd: "", errors: ["ไม่พบหัวตาราง (ต้องมีคอลัมน์ 'วันที่' และ 'เงินเข้า'/'เงินออก')"] };
    }

    const get = (cols: string[], field: string): string => {
      const idx = Object.keys(colMap).find((k) => colMap[+k] === field);
      return idx !== undefined ? (cols[+idx] ?? "").trim() : "";
    };

    const rows: NormalizedRow[] = [];
    let rowIndex = 0;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i];
      if (cols.every((c) => !c.trim())) continue; // skip blank lines

      const lineNo = i + 1; // 1-based for human-readable warnings
      const txnDate = parseTemplateDate(get(cols, "date"));
      const creditRaw = get(cols, "credit");
      const debitRaw = get(cols, "debit");
      const credit = parseAmountSatang(creditRaw);
      const debit = parseAmountSatang(debitRaw);

      if (!txnDate) { errors.push(`แถวที่ ${lineNo}: วันที่ไม่ถูกต้อง — ข้ามแถวนี้`); continue; }
      if (credit !== 0 && debit !== 0) { errors.push(`แถวที่ ${lineNo}: กรอกทั้งเงินเข้าและเงินออก — ให้กรอกอย่างใดอย่างหนึ่ง · ข้ามแถวนี้`); continue; }
      if (credit === 0 && debit === 0) { errors.push(`แถวที่ ${lineNo}: ไม่มีจำนวนเงิน — ข้ามแถวนี้`); continue; }

      const amountSatang = credit !== 0 ? Math.abs(credit) : -Math.abs(debit);
      rows.push({
        txnDate,
        valueDate: txnDate,
        amountSatang,
        balanceSatang: 0, // template has no running balance — continuity check skipped upstream
        ref1: get(cols, "ref") || null,
        ref2: null,
        description: get(cols, "desc") || null,
        channel: "TEMPLATE",
        rowIndex: rowIndex++,
        rawRow: {
          date: get(cols, "date"),
          credit: creditRaw,
          debit: debitRaw,
          desc: get(cols, "desc"),
          ref: get(cols, "ref"),
        },
      });
    }

    const dates = rows.map((r) => r.txnDate).sort();
    return {
      bankCode: "OTHER",
      formatVersion: TEMPLATE_FORMAT,
      accountNo: "",
      rows,
      periodStart: dates[0] ?? "",
      periodEnd: dates[dates.length - 1] ?? "",
      errors,
    };
  },
};
