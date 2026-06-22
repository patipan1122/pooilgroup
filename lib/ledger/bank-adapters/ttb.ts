// TTB bank adapter — parses TTB CSV export format.
//
// Format observed from sample 618068284290105822_TTB -4274.csv:
//   Row 0: headers
//   Columns (22): Account number, Transaction date, Effective date, Transaction code,
//     Cheque number, Withdrawal, Deposit, Balance, Teller Id, Transaction description,
//     Company name, Time, Currency, Channel, Statement Enrichment, Cross Reference No.,
//     Additional 1-6
//   Date: D/M/YYYY | Time: H:MM (separate column) | Amounts: plain decimal, no commas
//   Encoding: UTF-8 BOM

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseDateDMY, parseAmountSatang, parseBalanceSatang, parseCSVLines } from "./types";

export const ttbAdapter: BankAdapter = {
  bankCode: "TTB",
  formatVersion: "TTB_CSV_v1",

  detect(content: string): boolean {
    const lines = content.split(/\r?\n/).slice(0, 2).join(" ");
    return (
      lines.includes("Transaction date") &&
      lines.includes("Teller Id") &&
      lines.includes("Statement Enrichment")
    );
  },

  parse(content: string): ParseResult {
    const errors: string[] = [];
    const lines = parseCSVLines(content);
    if (lines.length < 2) {
      return { bankCode: "TTB", formatVersion: "TTB_CSV_v1", accountNo: "", rows: [], periodStart: "", periodEnd: "", errors: ["ไฟล์ว่างหรือไม่มีข้อมูล"] };
    }

    const headers = lines[0].map((h) => h.trim());
    const colIdx = (name: string) => headers.findIndex((h) => h === name);

    const idxAccountNo   = colIdx("Account number");
    const idxDate        = colIdx("Transaction date");
    const idxWithdrawal  = colIdx("Withdrawal");
    const idxDeposit     = colIdx("Deposit");
    const idxBalance     = colIdx("Balance");
    const idxTellerId    = colIdx("Teller Id");
    const idxDesc        = colIdx("Transaction description");
    const idxTime        = colIdx("Time");
    const idxChannel     = colIdx("Channel");
    const idxEnrichment  = colIdx("Statement Enrichment");
    const idxCrossRef    = colIdx("Cross Reference No.");

    const rows: NormalizedRow[] = [];
    let accountNo = "";

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i];
      if (!cols[idxDate]?.trim()) continue;

      const acct = cols[idxAccountNo]?.trim() ?? "";
      if (!accountNo && acct) accountNo = acct;

      const txnDate = parseDateDMY(cols[idxDate]);
      if (!txnDate) continue;

      const withdrawalRaw = cols[idxWithdrawal]?.trim() ?? "";
      const depositRaw    = cols[idxDeposit]?.trim() ?? "";
      const balanceRaw    = cols[idxBalance]?.trim() ?? "";

      const withdrawalSatang = parseAmountSatang(withdrawalRaw, true);  // debit → negative
      const depositSatang    = parseAmountSatang(depositRaw, false);    // credit → positive
      // One of the two will be zero
      const amountSatang = depositSatang !== 0 ? depositSatang : withdrawalSatang;

      const ref1 = cols[idxCrossRef]?.trim() || cols[idxTellerId]?.trim() || null;
      const ref2 = cols[idxEnrichment]?.trim() || null;
      const description = cols[idxDesc]?.trim() || null;
      const channel = cols[idxChannel]?.trim() || null;
      const timeStr = cols[idxTime]?.trim() || null;

      const rawRow: Record<string, string> = {};
      headers.forEach((h, idx) => { rawRow[h] = cols[idx]?.trim() ?? ""; });
      if (timeStr) rawRow["Time"] = timeStr;

      // กุญแจรายการที่เสถียรข้าม export: วันที่ + เวลา + เลขอ้างอิงข้ามระบบ (Cross Reference No.)
      // (ไม่ขยับแม้ export คนละช่วง — ต่างจาก "ยอดคงเหลือ" ที่เลื่อนได้) → กันซ้ำแม่นยำ
      const sCrossRef = cols[idxCrossRef]?.trim() ?? "";
      const externalRef = (timeStr || sCrossRef)
        ? `${txnDate}|${timeStr ?? ""}|${sCrossRef}`
        : null;

      rows.push({
        txnDate,
        valueDate: txnDate, // TTB effective date same as txn date
        amountSatang,
        balanceSatang: parseBalanceSatang(balanceRaw),
        ref1,
        ref2,
        description,
        channel,
        rowIndex: i - 1,
        accountNo: acct || undefined, // TTB ACCHIST can carry several accounts in one file
        externalRef,
        rawRow,
      });
    }

    if (!accountNo && rows.length === 0) {
      errors.push("ไม่พบข้อมูล transaction ในไฟล์ TTB");
    }

    const dates = rows.map((r) => r.txnDate).sort();
    return {
      bankCode: "TTB",
      formatVersion: "TTB_CSV_v1",
      accountNo,
      rows,
      periodStart: dates[0] ?? "",
      periodEnd: dates[dates.length - 1] ?? "",
      errors,
    };
  },
};
