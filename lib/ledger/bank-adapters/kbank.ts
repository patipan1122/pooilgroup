// KBank (KBIZ) adapter — parses K-BIZNET / KBIZ CSV statement export.
//
// Format observed from sample 618068282880557363_KBIZ -0886.csv:
//   ~10 metadata rows before actual header row (col 1 = "วันที่")
//   Columns with EMPTY intercalating columns:
//     [0]=blank [1]=วันที่ [2]=เวลา/ วันที่มีผล [3]=รายการ [4]=ถอนเงิน [5]=blank
//     [6]=ฝากเงิน [7]=blank [8]=ยอดคงเหลือ [9]=blank [10]=ช่องทาง [11]=blank [12]=รายละเอียด
//   Date: D/M/YYYY or DD-MM-YY (both seen across exports) | Time: H:MM (separate column)
//   Amounts: "1,775.00" (with commas)
//   Account number in metadata row (เลขที่บัญชีเงินฝาก)
//   Opening balance row (ยอดยกมา) after header — skip
//   Encoding: UTF-8 BOM

import type { BankAdapter, ParseResult, NormalizedRow } from "./types";
import { parseDateFlexibleDMY, parseAmountSatang, parseBalanceSatang, parseCSVLines } from "./types";

export const kbankAdapter: BankAdapter = {
  bankCode: "KBANK",
  formatVersion: "KBANK_KBIZ_v1",

  detect(content: string): boolean {
    return (
      content.includes("K-DEPOSIT STATEMENT") ||
      content.includes("รายการเดินบัญชีเงินฝากออมทรัพย์") ||
      content.includes("เลขที่บัญชีเงินฝาก")
    );
  },

  parse(content: string): ParseResult {
    const errors: string[] = [];
    const lines = parseCSVLines(content);

    // Find account number from metadata rows
    let accountNo = "";
    let headerRowIdx = -1;

    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const row = lines[i];
      // Look for "เลขที่บัญชีเงินฝาก" in any column
      for (let j = 0; j < row.length; j++) {
        if (row[j].includes("เลขที่บัญชีเงินฝาก")) {
          // Account number sits a few (variable) blank columns to the right —
          // scan rightward for the first non-empty cell rather than a fixed offset.
          for (let k = j + 1; k < row.length; k++) {
            const v = row[k]?.trim();
            if (v) {
              accountNo = v;
              break;
            }
          }
        }
      }
      // Find the actual header row: col[1] === "วันที่"
      if (row[1]?.trim() === "วันที่") {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      return {
        bankCode: "KBANK", formatVersion: "KBANK_KBIZ_v1",
        accountNo, rows: [], periodStart: "", periodEnd: "",
        errors: ["ไม่พบ header row 'วันที่' ในไฟล์ KBank"],
      };
    }

    const rows: NormalizedRow[] = [];

    for (let i = headerRowIdx + 1; i < lines.length; i++) {
      const cols = lines[i];
      const dateRaw = cols[1]?.trim() ?? "";
      const desc    = cols[3]?.trim() ?? "";

      // Skip opening balance marker row
      if (desc === "ยอดยกมา" || desc === "ยอดยกไป") continue;
      if (!dateRaw) continue;

      const txnDate = parseDateFlexibleDMY(dateRaw);
      if (!txnDate) continue;

      const withdrawalRaw = cols[4]?.trim() ?? "";
      const depositRaw    = cols[6]?.trim() ?? "";
      const balanceRaw    = cols[8]?.trim() ?? "";

      const withdrawalSatang = parseAmountSatang(withdrawalRaw, true);
      const depositSatang    = parseAmountSatang(depositRaw, false);
      const amountSatang     = depositSatang !== 0 ? depositSatang : withdrawalSatang;

      // Balance might be combined "13,305.53" — handle commas
      const balanceSatang = parseBalanceSatang(balanceRaw);

      const channel     = cols[10]?.trim() || null;
      const detail      = cols[12]?.trim() || null;
      const timeStr     = cols[2]?.trim() || null;

      const rawRow: Record<string, string> = {
        วันที่: dateRaw,
        "เวลา/ วันที่มีผล": timeStr ?? "",
        รายการ: desc,
        ถอนเงิน: withdrawalRaw,
        ฝากเงิน: depositRaw,
        ยอดคงเหลือ: balanceRaw,
        ช่องทาง: channel ?? "",
        รายละเอียด: detail ?? "",
      };

      // กุญแจรายการที่เสถียรข้าม export: วันที่ + เวลา + รายการ + รายละเอียด
      // (ไม่ขยับแม้ export คนละช่วง — ต่างจาก "ยอดคงเหลือ" ที่เลื่อนได้) → กันซ้ำแม่นยำ
      const externalRef = timeStr
        ? `${txnDate}|${timeStr}|${desc}|${detail ?? ""}`
        : null;

      rows.push({
        txnDate,
        valueDate: txnDate,
        amountSatang,
        balanceSatang,
        ref1: detail,
        ref2: desc !== detail ? desc : null,
        description: detail || desc,
        channel,
        rowIndex: i - headerRowIdx - 1,
        externalRef,
        rawRow,
      });
    }

    if (rows.length === 0) {
      errors.push("ไม่พบข้อมูล transaction ในไฟล์ KBank");
    }

    const dates = rows.map((r) => r.txnDate).sort();
    return {
      bankCode: "KBANK",
      formatVersion: "KBANK_KBIZ_v1",
      accountNo,
      rows,
      periodStart: dates[0] ?? "",
      periodEnd: dates[dates.length - 1] ?? "",
      errors,
    };
  },
};
