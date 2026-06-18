// Bank adapter types — shared between all bank parsers.
// A "NormalizedRow" is what every adapter must produce regardless of source format.
// Amounts are always in satang (integer × 100) to avoid floating-point errors.

export type BankCode =
  | "KBANK" | "SCB" | "TTB" | "BBL" | "BAAC"
  | "KTB" | "BAY" | "GSB" | "CIMB" | "UOB" | "TRUEMONEY" | "OTHER";

/** Thai display names — single source of truth for every bank-recon surface. */
export const BANK_LABELS: Record<string, string> = {
  KBANK:     "กสิกรไทย",
  SCB:       "ไทยพาณิชย์",
  TTB:       "ทหารไทยธนชาต",
  BBL:       "กรุงเทพ",
  BAAC:      "ธ.ก.ส.",
  KTB:       "กรุงไทย",
  BAY:       "กรุงศรีฯ",
  GSB:       "ออมสิน",
  CIMB:      "CIMB",
  UOB:       "UOB",
  TRUEMONEY: "ทรูมันนี่",
  OTHER:     "อื่นๆ",
};

/** Ordered list for dropdowns in the bank-account settings form. */
export const BANK_OPTIONS: { code: string; label: string }[] = [
  "BBL", "KBANK", "SCB", "TTB", "BAAC", "KTB", "BAY", "GSB", "CIMB", "UOB", "TRUEMONEY", "OTHER",
].map((code) => ({ code, label: BANK_LABELS[code] ?? code }));

export interface NormalizedRow {
  txnDate: string;     // ISO: 'YYYY-MM-DD'
  valueDate: string | null;
  amountSatang: number; // positive = credit (deposit), negative = debit (withdrawal)
  balanceSatang: number;
  ref1: string | null;
  ref2: string | null;
  description: string | null;
  channel: string | null;
  rowIndex: number;    // 0-based index in file (for lineHash rowIndex salt)
  accountNo?: string;  // per-row account number (multi-account files e.g. TTB ACCHIST);
                       // when unset the row belongs to ParseResult.accountNo (single-account file)
  rawRow: Record<string, string>; // original CSV columns for raw_row_json
}

export interface ParseResult {
  bankCode: BankCode;
  formatVersion: string;
  accountNo: string;
  rows: NormalizedRow[];
  periodStart: string; // ISO date of earliest txn
  periodEnd: string;   // ISO date of latest txn
  errors: string[];    // non-fatal warnings (e.g. balance mismatch)
}

export interface BankAdapter {
  bankCode: BankCode;
  formatVersion: string;
  /** Detect if this adapter can handle the file content (before full parse). */
  detect(content: string): boolean;
  /** Parse raw file content (UTF-8 string) into normalized rows. */
  parse(content: string): ParseResult;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Parse a Thai-style date: 'D/M/YYYY' or 'DD/MM/YYYY' → 'YYYY-MM-DD' */
export function parseDateDMY(raw: string): string | null {
  if (!raw?.trim()) return null;
  const [d, m, y] = raw.trim().split("/");
  if (!d || !m || !y) return null;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Parse a Day-Month-Year date that may use '/' OR '-' (or '.') separators and a
 * 2- or 4-digit year. KBank/BBL/SCB/TTB all export DMY but differ in punctuation:
 * '1/3/2026', '01-03-26', '13-03-2026' → 'YYYY-MM-DD'.
 * 2-digit years are treated as CE (20YY) — Thai bank exports use Gregorian years.
 * Returns null if day>31 / month>12 (guards against MDY files sneaking through).
 */
export function parseDateFlexibleDMY(raw: string): string | null {
  if (!raw?.trim()) return null;
  // Some banks (BBL) combine date + time in one column ("18/06/2026 15:32:04") —
  // keep only the date token before splitting. No-op for date-only inputs.
  const datePart = raw.trim().split(/\s+/)[0];
  const parts = datePart.split(/[\/\-.]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (!d || !m || !y) return null;
  if (y.length === 2) y = `20${y}`;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  const dn = Number(dd);
  const mn = Number(mm);
  if (!Number.isInteger(dn) || !Number.isInteger(mn)) return null;
  if (dn < 1 || dn > 31 || mn < 1 || mn > 12) return null;
  return `${y}-${mm}-${dd}`;
}

/**
 * Decide whether a column of day/month-or-month/day dates is DAY-FIRST.
 * Some banks (BBL) export the SAME column as either D/M/Y or M/D/Y depending on
 * the export's locale, so we must detect per-file instead of hard-coding:
 *   - if any first component > 12  → it can only be a day      → DAY-FIRST (D/M)
 *   - else if any second component > 12 → it can only be a day → MONTH-FIRST (M/D)
 *   - all ambiguous (every value ≤ 12) → default to day-first (Thai convention)
 * Returns true for day-first (D/M), false for month-first (M/D).
 */
export function detectDayFirst(samples: string[]): boolean {
  let firstGt12 = false;
  let secondGt12 = false;
  for (const s of samples) {
    if (!s?.trim()) continue;
    const datePart = s.trim().split(/\s+/)[0];
    const p = datePart.split(/[\/\-.]/);
    if (p.length < 2) continue;
    const a = Number(p[0]);
    const b = Number(p[1]);
    if (Number.isInteger(a) && a > 12) firstGt12 = true;
    if (Number.isInteger(b) && b > 12) secondGt12 = true;
  }
  // month-first only when the 2nd field is unambiguously a day and the 1st never is
  if (secondGt12 && !firstGt12) return false;
  return true; // day-first when 1st>12 seen, or when fully ambiguous
}

/**
 * Parse a 'D/M/Y' or 'M/D/Y' date (optionally with a trailing time) using a
 * pre-resolved field order → 'YYYY-MM-DD'. Pair with detectDayFirst().
 * 2-digit years → 20YY. Returns null on out-of-range day/month.
 */
export function parseDateOrdered(raw: string, dayFirst: boolean): string | null {
  if (!raw?.trim()) return null;
  const datePart = raw.trim().split(/\s+/)[0];
  const parts = datePart.split(/[\/\-.]/);
  if (parts.length !== 3) return null;
  const [p0, p1, p2] = parts;
  if (!p0 || !p1 || !p2) return null;
  const d = dayFirst ? p0 : p1;
  const m = dayFirst ? p1 : p0;
  let y = p2;
  if (y.length === 2) y = `20${y}`;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  const dn = Number(dd);
  const mn = Number(mm);
  if (!Number.isInteger(dn) || !Number.isInteger(mn)) return null;
  if (dn < 1 || dn > 31 || mn < 1 || mn > 12) return null;
  return `${y}-${mm}-${dd}`;
}

/** Parse a US-style date: 'M/D/YYYY' or combined 'M/D/YYYY H:MM' → 'YYYY-MM-DD' */
export function parseDateMDY(raw: string): string | null {
  if (!raw?.trim()) return null;
  const datePart = raw.trim().split(" ")[0];
  const [m, d, y] = datePart.split("/");
  if (!d || !m || !y) return null;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Remove commas, "THB" suffix, quotes, leading minus. Returns cents (satang) as integer. */
export function parseAmountSatang(raw: string, isDebit = false): number {
  if (!raw?.trim()) return 0;
  let s = raw.trim().replace(/"/g, "").replace(/,/g, "").replace(/\s*THB\s*/i, "").trim();
  const negative = s.startsWith("-") || isDebit;
  s = s.replace(/^-/, "");
  const float = parseFloat(s);
  if (isNaN(float)) return 0;
  const satang = Math.round(float * 100);
  return negative ? -satang : satang;
}

/** Remove commas, "THB" suffix from balance string. Returns satang integer. */
export function parseBalanceSatang(raw: string): number {
  if (!raw?.trim()) return 0;
  const s = raw.trim().replace(/"/g, "").replace(/,/g, "").replace(/\s*THB\s*/i, "").trim();
  return Math.round(parseFloat(s) * 100) || 0;
}

/** Split CSV line respecting quoted fields (handles BBL's "55,607.43 THB" values). */
export function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Strip UTF-8 BOM (﻿) from the beginning of file content. */
export function stripBOM(content: string): string {
  return content.startsWith("﻿") ? content.slice(1) : content;
}

/** Parse all CSV lines, skipping empty trailing rows. */
export function parseCSVLines(content: string): string[][] {
  return stripBOM(content)
    .split(/\r?\n/)
    .map((line) => splitCSVLine(line))
    .filter((cols) => cols.some((c) => c.trim() !== ""));
}
