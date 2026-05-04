// Reconcile: binary balance check (CASHHUB §13)
// "ยอดตรง = กดได้ / ไม่ตรง = กดไม่ได้" — no thresholds.

export interface ReconcileInput {
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
}

export interface ReconcileResult {
  isBalanced: boolean;
  totalReceived: number;
  diff: number;
  message: string;
}

// Use integer satang for floating-point safety
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
  const isBalanced = diffSatang === 0 && sales > 0;

  let message = "";
  if (sales === 0) {
    message = "กรอกยอดขายก่อน";
  } else if (isBalanced) {
    message = "ยอดตรงพอดี";
  } else if (diffSatang > 0) {
    message = `ยอดรับยังขาดอีก ฿${(diff).toLocaleString("th-TH")} — ตรวจสอบตัวเลขอีกครั้ง`;
  } else {
    message = `ยอดรับเกินมา ฿${Math.abs(diff).toLocaleString("th-TH")} — มีที่กรอกผิดหรือเปล่า?`;
  }

  return { isBalanced, totalReceived, diff, message };
}
