// BBL (Bangkok Bank) adapter — parses BBL iBanking CSV export.
//
// Format observed from sample 618068275279954283_BBL -9934.csv:
//   Row 0: "Export Date and Time,,,..." (metadata label)
//   Row 1: "6/12/2026 8:17,,..." (the export timestamp)
//   Row 2: actual column headers (15 cols)
//   Columns: Transaction Date and Time, Value Date, Description, Cheque Number,
//     Debit Amount, Credit Amount, Ledger Balance, Channel of transaction,
//     Branch, Location, TerminalID, Narrative, Counter Party Account Name,
//     Counter Party Account Number, FX Rate
//
// CRITICAL QUIRKS:
//   1. Date format is D/M/YYYY (Thai/day-first) — e.g. "18/06/2026" = 18 June.
//      (Earlier code wrongly assumed US M/D/YYYY, which silently swapped day/month
//       and threw "date out of range" once a real day>12 appeared.)
//   2. Date+Time combined in one column: "18/06/2026 15:32:04"
//   3. Amounts include "THB" suffix and commas: "55,607.43 THB"
//   4. Debit is NEGATIVE: "-5.00 THB"
//   5. Missing amount = "0" (not empty string)
//   6. Last row may be blank
//   7. Encoding: UTF-8 BOM

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseDateFlexibleDMY, parseAmountSatang, parseBalanceSatang, parseCSVLines } from "./types";

export const bblAdapter: BankAdapter = {
  bankCode: "BBL",
  formatVersion: "BBL_IBANKING_v1",

  detect(content: string): boolean {
    const lines = content.split(/\r?\n/).slice(0, 4).join(" ");
    return (
      lines.includes("Export Date and Time") ||
      (lines.includes("Transaction Date and Time") &&
       lines.includes("Ledger Balance") &&
       lines.includes("Counter Party Account"))
    );
  },

  parse(content: string): ParseResult {
    const errors: string[] = [];
    const lines = parseCSVLines(content);

    // Row 0 = "Export Date and Time,..." label
    // Row 1 = "6/12/2026 8:17,..." value
    // Row 2 = headers
    // Row 3+ = data

    const HEADER_ROW = 2;
    if (lines.length <= HEADER_ROW) {
      return {
        bankCode: "BBL", formatVersion: "BBL_IBANKING_v1",
        accountNo: "", rows: [], periodStart: "", periodEnd: "",
        errors: ["ไฟล์ BBL ไม่มีข้อมูล header"],
      };
    }

    const headers = lines[HEADER_ROW].map((h) => h.trim());
    const col = (name: string) => headers.findIndex((h) => h === name);

    const idxTxnDateTime = col("Transaction Date and Time");
    const idxValueDate   = col("Value Date");
    const idxDesc        = col("Description");
    const idxCheque      = col("Cheque Number");
    const idxDebit       = col("Debit Amount");   // negative values like "-5.00 THB"
    const idxCredit      = col("Credit Amount");  // positive values like "4,800.00 THB"
    const idxBalance     = col("Ledger Balance");
    const idxChannel     = col("Channel of transaction");
    const idxNarrative   = col("Narrative");
    const idxCptyName    = col("Counter Party Account Name");
    const idxCptyAcct    = col("Counter Party Account Number");

    const rows: NormalizedRow[] = [];

    for (let i = HEADER_ROW + 1; i < lines.length; i++) {
      const cols = lines[i];
      const dateTimeRaw = cols[idxTxnDateTime]?.trim() ?? "";
      if (!dateTimeRaw) continue;

      // D/M/YYYY H:MM:SS → 'YYYY-MM-DD' (Thai day-first; strips the time portion)
      const txnDate = parseDateFlexibleDMY(dateTimeRaw);
      if (!txnDate) continue;

      const valueDateRaw = cols[idxValueDate]?.trim() ?? "";
      const valueDate    = parseDateFlexibleDMY(valueDateRaw);

      const debitRaw  = cols[idxDebit]?.trim() ?? "0";
      const creditRaw = cols[idxCredit]?.trim() ?? "0";
      const balanceRaw = cols[idxBalance]?.trim() ?? "0";

      // Debit column already has negative sign; credit is positive
      const debitSatang  = debitRaw !== "0" ? parseAmountSatang(debitRaw, false) : 0; // preserves negative sign
      const creditSatang = creditRaw !== "0" ? parseAmountSatang(creditRaw, false) : 0;
      // Net: if both are 0 the row is meaningless
      const amountSatang = creditSatang !== 0 ? creditSatang : debitSatang;

      const desc      = cols[idxDesc]?.trim() || null;
      const narrative = cols[idxNarrative]?.trim() || null;
      const cheque    = cols[idxCheque]?.trim() || null;
      const channel   = cols[idxChannel]?.trim() || null;
      const cptyName  = cols[idxCptyName]?.trim() || null;
      const cptyAcct  = cols[idxCptyAcct]?.trim() || null;

      const ref1 = narrative || desc;
      const ref2 = cptyAcct ? `${cptyName ?? ""} ${cptyAcct}`.trim() : cheque;

      const rawRow: Record<string, string> = {};
      headers.forEach((h, idx) => { rawRow[h] = cols[idx]?.trim() ?? ""; });

      rows.push({
        txnDate,
        valueDate,
        amountSatang,
        balanceSatang: parseBalanceSatang(balanceRaw),
        ref1: ref1 || null,
        ref2: ref2 || null,
        description: desc || narrative,
        channel,
        rowIndex: i - HEADER_ROW - 1,
        rawRow,
      });
    }

    if (rows.length === 0) {
      errors.push("ไม่พบข้อมูล transaction ในไฟล์ BBL");
    }

    const dates = rows.map((r) => r.txnDate).sort();
    return {
      bankCode: "BBL",
      formatVersion: "BBL_IBANKING_v1",
      accountNo: "", // BBL CSV doesn't include account number — extracted from filename
      rows,
      periodStart: dates[0] ?? "",
      periodEnd: dates[dates.length - 1] ?? "",
      errors,
    };
  },
};
