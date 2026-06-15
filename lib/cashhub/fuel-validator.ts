// CashHub ⛽ ปั๊มน้ำมัน 62 — reconciliation validator.
//
// THIS is the product (per the DevilsAdvocate): an iframe of the sheet catches zero
// errors. We RE-DERIVE every diff in integer satang and classify each shift row so the
// management page can surface where the bookkeeper's hand entry doesn't add up —
// WITHOUT crying wolf on the normal "money submitted, not yet at the bank" case.

import type { FuelShiftRow } from "./fuel-parser";

export type ReconStatus =
  | "ok"
  | "pending_deposit"
  | "shortage"
  | "overage"
  | "mismatch";

export type AnomalyCode =
  | "sales_no_liters"
  | "liters_no_sales"
  | "negative_value"
  | "bank_total_mismatch"
  | "missing_shift";

export interface FuelRecon {
  reconStatus: ReconStatus;
  anomalyCodes: AnomalyCode[];
  cashDiffCalc: number | null; // banked − submitted (re-derived)
  reasons: string[]; // plain-Thai "why" for the tooltip / copy-to-LINE
}

const TOL_SATANG = 100; // ฿1 — a clean sheet shows ZERO false-red

function satang(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(v * 100);
}

const ANOMALY_LABEL: Record<AnomalyCode, string> = {
  sales_no_liters: "มียอดขายแต่ลิตรเป็น 0 (ผิดปกติสำหรับปั๊ม)",
  liters_no_sales: "มีลิตรแต่ยอดขายเป็น 0",
  negative_value: "มีค่าติดลบที่ไม่ควรติดลบ (ลิตร/ยอดขาย/เงินส่ง)",
  bank_total_mismatch: "QR+บัตร แยกบัญชี ไม่เท่ายอดรวมต่อกะ",
  missing_shift: "วันนี้มีกะเดียว (ขาดเช้าหรือค่ำ)",
};

/** Classify one shift row. Day-level checks (missing_shift) are added afterward. */
export function classifyRow(row: FuelShiftRow): FuelRecon {
  const anomalyCodes: AnomalyCode[] = [];
  const reasons: string[] = [];

  const submitted = satang(row.cashSubmitted);
  const banked = satang(row.cashBanked);
  const diffSheet = satang(row.cashDiffSheet);

  const cashDiffCalc =
    row.cashBanked != null && row.cashSubmitted != null
      ? Math.round((row.cashBanked - row.cashSubmitted) * 100) / 100
      : null;

  // ---- recon status (priority: pending > mismatch > shortage/overage > ok) ----
  let reconStatus: ReconStatus = "ok";
  if (banked === null && submitted !== null && submitted > 0) {
    reconStatus = "pending_deposit";
    reasons.push("ส่งเงินสดแล้วแต่ยังไม่เข้าบัญชี (รอนำฝาก)");
  } else if (banked !== null && submitted !== null) {
    const calc = banked - submitted;
    if (diffSheet !== null && Math.abs(calc - diffSheet) > TOL_SATANG) {
      reconStatus = "mismatch";
      reasons.push(
        `ส่วนต่างในชีต (${(diffSheet / 100).toLocaleString()}) ไม่ตรงกับที่คำนวณ (${(calc / 100).toLocaleString()})`,
      );
    } else if (calc < -TOL_SATANG) {
      reconStatus = "shortage";
      reasons.push(`เงินขาด ${(Math.abs(calc) / 100).toLocaleString()} บาท`);
    } else if (calc > TOL_SATANG) {
      reconStatus = "overage";
      reasons.push(`เงินเกิน ${(calc / 100).toLocaleString()} บาท`);
    }
  }

  // ---- additive anomaly codes ----
  const liters = satang(row.liters);
  const sales = satang(row.totalSales);
  if (sales !== null && sales > 0 && (liters === null || liters === 0)) {
    anomalyCodes.push("sales_no_liters");
  }
  if (liters !== null && liters > 0 && (sales === null || sales === 0)) {
    anomalyCodes.push("liters_no_sales");
  }
  if (
    (row.liters ?? 0) < 0 ||
    (row.totalSales ?? 0) < 0 ||
    (row.cashSubmitted ?? 0) < 0
  ) {
    anomalyCodes.push("negative_value");
  }
  // QR+card by account should equal the per-shift grand total (col25)
  const sideSum =
    row.transferTotal != null || row.cardTotal != null
      ? (row.transferTotal ?? 0) + (row.cardTotal ?? 0)
      : null;
  if (
    row.grandTotalBoth != null &&
    sideSum != null &&
    Math.abs(Math.round(row.grandTotalBoth * 100) - Math.round(sideSum * 100)) >
      TOL_SATANG
  ) {
    anomalyCodes.push("bank_total_mismatch");
  }

  for (const c of anomalyCodes) reasons.push(ANOMALY_LABEL[c]);

  return { reconStatus, anomalyCodes, cashDiffCalc, reasons };
}

/**
 * Classify a whole month of rows, adding the day-level "missing_shift" flag
 * (a day with only เช้า or only ค่ำ). Returns a parallel array of FuelRecon.
 */
export function classifyRows(rows: FuelShiftRow[]): FuelRecon[] {
  const recon = rows.map(classifyRow);

  // count shifts per (date) and flag days with a single shift
  const byDate = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const arr = byDate.get(r.reportDate) ?? [];
    arr.push(i);
    byDate.set(r.reportDate, arr);
  });
  for (const idxs of byDate.values()) {
    if (idxs.length === 1) {
      const i = idxs[0]!;
      if (!recon[i]!.anomalyCodes.includes("missing_shift")) {
        recon[i]!.anomalyCodes.push("missing_shift");
        recon[i]!.reasons.push(ANOMALY_LABEL.missing_shift);
      }
    }
  }
  return recon;
}

export function isFlagged(r: FuelRecon): boolean {
  return (
    r.reconStatus === "shortage" ||
    r.reconStatus === "overage" ||
    r.reconStatus === "mismatch" ||
    r.anomalyCodes.length > 0
  );
}

export const RECON_LABEL: Record<ReconStatus, string> = {
  ok: "ปกติ",
  pending_deposit: "รอเงินเข้า",
  shortage: "เงินขาด",
  overage: "เงินเกิน",
  mismatch: "ตัวเลขไม่ตรง",
};
