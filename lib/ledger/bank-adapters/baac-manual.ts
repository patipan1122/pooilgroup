// BAAC (ธ.ก.ส.) manual entry adapter — Phase 1 workaround for PDF-only BAAC.
// Accepts a structured JSON payload (not a file) since BAAC doesn't export CSV.
// Source type = 'MANUAL_BAAC'. Downstream reconcile logic treats it identically.

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseAmountSatang, parseBalanceSatang } from "./types";

export interface BaacManualEntry {
  txnDate: string;   // 'YYYY-MM-DD'
  type: "DR" | "CR"; // debit or credit
  amount: number;    // THB (not satang)
  ref: string;
  description: string;
  balance: number;   // running balance in THB
}

/** Convert a manual BAAC entry list into a ParseResult (same shape as CSV adapters). */
export function parseBaacManual(
  accountNo: string,
  entries: BaacManualEntry[],
): ParseResult {
  const rows: NormalizedRow[] = entries.map((e, idx) => ({
    txnDate: e.txnDate,
    valueDate: e.txnDate,
    amountSatang: e.type === "DR"
      ? -parseAmountSatang(String(e.amount))
      : parseAmountSatang(String(e.amount)),
    balanceSatang: parseBalanceSatang(String(e.balance)),
    ref1: e.ref || null,
    ref2: null,
    description: e.description || null,
    channel: "MANUAL_BAAC",
    rowIndex: idx,
    rawRow: {
      txnDate: e.txnDate,
      type: e.type,
      amount: String(e.amount),
      ref: e.ref,
      description: e.description,
      balance: String(e.balance),
    },
  }));

  const dates = rows.map((r) => r.txnDate).sort();
  return {
    bankCode: "BAAC",
    formatVersion: "MANUAL_BAAC_v1",
    accountNo,
    rows,
    periodStart: dates[0] ?? "",
    periodEnd: dates[dates.length - 1] ?? "",
    errors: [],
  };
}

// Stub BankAdapter (detect always false — BAAC uses parseBaacManual directly)
export const baacAdapter: BankAdapter = {
  bankCode: "BAAC",
  formatVersion: "MANUAL_BAAC_v1",
  detect: () => false,
  parse: () => ({ bankCode: "BAAC", formatVersion: "MANUAL_BAAC_v1", accountNo: "", rows: [], periodStart: "", periodEnd: "", errors: ["ใช้ parseBaacManual() แทน"] }),
};
