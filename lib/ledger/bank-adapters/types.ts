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
  const parts = raw.trim().split(/[\/\-.]/);
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
