// SCB bank adapter — parses SCB CSV export format.
//
// Format observed from sample 618068283199062600_SCB -0820.CSV:
//   Row 0: headers
//   Columns (15): Account Number, Account Name, Account Type, Currency Code,
//     Branch Code, Date, Time, Tr Code, Tr Description, Channel, Cheque No.,
//     Withdrawal, Deposit, Outstanding Balance, Description
//   Date: D/M/YYYY | Time: H:MM (separate) | Amounts: plain decimal, no commas
//   Encoding: UTF-8 BOM

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseDateDMY, parseAmountSatang, parseBalanceSatang, parseCSVLines } from "./types";

export const scbAdapter: BankAdapter = {
  bankCode: "SCB",
  formatVersion: "SCB_CSV_v1",

  detect(content: string): boolean {
    const firstLine = content.split(/\r?\n/)[0] ?? "";
    return (
      firstLine.includes("Account Number") &&
      firstLine.includes("Outstanding Balance") &&
      firstLine.includes("Tr Code")
    );
  },

  parse(content: string): ParseResult {
    const errors: string[] = [];
    const lines = parseCSVLines(content);
    if (lines.length < 2) {
      return { bankCode: "SCB", formatVersion: "SCB_CSV_v1", accountNo: "", rows: [], periodStart: "", periodEnd: "", errors: ["ไฟล์ว่างหรือไม่มีข้อมูล"] };
    }

    const headers = lines[0].map((h) => h.trim());
    const col = (name: string) => headers.findIndex((h) => h === name);

    const idxAccountNo  = col("Account Number");
    const idxDate       = col("Date");
    const idxTime       = col("Time");
    const idxTrCode     = col("Tr Code");
    const idxTrDesc     = col("Tr Description");
    const idxChannel    = col("Channel");
    const idxCheque     = col("Cheque No.");
    const idxWithdrawal = col("Withdrawal");
    const idxDeposit    = col("Deposit");
    const idxBalance    = col("Outstanding Balance");
    const idxDesc       = col("Description");

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

      const withdrawalSatang = parseAmountSatang(withdrawalRaw, true);
      const depositSatang    = parseAmountSatang(depositRaw, false);
      const amountSatang     = depositSatang !== 0 ? depositSatang : withdrawalSatang;

      const ref1 = cols[idxCheque]?.trim() || cols[idxTrCode]?.trim() || null;
      const ref2 = cols[idxDesc]?.trim() || null;
      const description = cols[idxTrDesc]?.trim() || null;
      const channel = cols[idxChannel]?.trim() || null;

      const rawRow: Record<string, string> = {};
      headers.forEach((h, idx) => { rawRow[h] = cols[idx]?.trim() ?? ""; });

      // กุญแจรายการที่เสถียรข้าม export: เวลาเกิดรายการจริง + เลขเครื่อง + เลขบัญชีคู่ค้า
      // (ไม่ขยับแม้ export คนละช่วง — ต่างจาก "ยอดคงเหลือ") → ใช้กันซ้ำแม่นยำ
      const txnTime = rawRow["Transaction Date and Time"] ?? "";
      const terminal = rawRow["TerminalID"] ?? "";
      const cpAcct = rawRow["Counter Party Account Number"] ?? "";
      const externalRef = txnTime || terminal || cpAcct ? `${txnTime}|${terminal}|${cpAcct}` : null;

      rows.push({
        txnDate,
        valueDate: txnDate,
        amountSatang,
        balanceSatang: parseBalanceSatang(balanceRaw),
        ref1,
        ref2,
        description,
        channel,
        rowIndex: i - 1,
        accountNo: acct || undefined, // SCB HISTSTMT can carry several accounts in one file
        externalRef,
        rawRow,
      });
    }

    if (!accountNo && rows.length === 0) {
      errors.push("ไม่พบข้อมูล transaction ในไฟล์ SCB");
    }

    const dates = rows.map((r) => r.txnDate).sort();
    return {
      bankCode: "SCB",
      formatVersion: "SCB_CSV_v1",
      accountNo,
      rows,
      periodStart: dates[0] ?? "",
      periodEnd: dates[dates.length - 1] ?? "",
      errors,
    };
  },
};
