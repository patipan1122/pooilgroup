// Reconcile: balance check (CASHHUB §13)
// Rule: รับ < ขาย = block (under-collected, blocks submit)
//       รับ = ขาย = pass (perfect)
//       รับ > ขาย = pass with info hint (over-collected is allowed in real biz)
// feedback_overcollect_allowed.md — เงินเกิน OK · only เงินขาด blocks

export interface ReconcileInput {
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
}

export type ReconcileStatus = "empty" | "balanced" | "over" | "under";

export interface ReconcileResult {
  /** Strict equality (received === sales). Kept for analytics/back-compat. */
  isBalanced: boolean;
  /** Pass = balanced OR over. Drives submit-button enabled state. */
  isAcceptable: boolean;
  status: ReconcileStatus;
  totalReceived: number;
  /** sales - received (positive = under, negative = over) */
  diff: number;
  message: string;
}

function toSatang(v: number): number {
  return Math.round(v * 100);
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { totalSales, cash, transfer, card, credit, shortage } = input;
  const sales = toSatang(totalSales || 0);
  const received =
    toSatang(cash || 0) +
    toSatang(transfer || 0) +
    toSatang(card || 0) +
    toSatang(credit || 0) +
    toSatang(shortage || 0);
  const diffSatang = sales - received;
  const totalReceived = received / 100;
  const diff = diffSatang / 100;

  let status: ReconcileStatus;
  let message = "";
  if (sales === 0) {
    status = "empty";
    message = "กรอกยอดขายก่อน";
  } else if (diffSatang === 0) {
    status = "balanced";
    message = "ยอดตรงพอดี";
  } else if (diffSatang > 0) {
    status = "under";
    message = `ยอดรับยังขาดอีก ฿${diff.toLocaleString("th-TH")} — ตรวจสอบตัวเลขอีกครั้ง`;
  } else {
    status = "over";
    message = `รับเกินมา ฿${Math.abs(diff).toLocaleString("th-TH")} — ส่งได้เลย`;
  }

  const isBalanced = status === "balanced";
  const isAcceptable = status === "balanced" || status === "over";

  return { isBalanced, isAcceptable, status, totalReceived, diff, message };
}
