// Auto-check rules — Pre-check ก่อน Manager Approve (CASHHUB §4 Rule 7)
// Pure function. Takes a report + history slice → returns checklist results.

export interface AutoCheckInput {
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  submittedAt: string | null;
  reportDate: string;
  hasReconcile: boolean;
  /** Approved totals from this branch over last 30 days */
  history30dTotals: number[];
  /** Today's other shifts (if multi-shift) — to validate complete coverage */
  todayOtherShifts?: Array<{ shift: string; status: string; total: number }>;
}

export interface AutoCheckResult {
  passed: boolean;
  checks: Array<{
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }>;
  /** Quick grade for Telegram message */
  summary: string;
}

export function autoCheck(input: AutoCheckInput): AutoCheckResult {
  const checks: AutoCheckResult["checks"] = [];

  // 1) Reconcile balance
  if (input.hasReconcile) {
    const recv =
      input.cash + input.transfer + input.card + input.credit + input.shortage;
    const diff = input.totalSales - recv;
    if (Math.abs(diff) < 0.01) {
      checks.push({
        label: "Reconcile",
        status: "pass",
        detail: "ยอดรับ = ยอดขาย ตรงพอดี",
      });
    } else {
      checks.push({
        label: "Reconcile",
        status: "fail",
        detail: `ต่าง ฿${Math.abs(diff).toLocaleString("th-TH")}`,
      });
    }
  } else {
    checks.push({
      label: "Reconcile",
      status: "pass",
      detail: "ไม่ตรวจ (POS จัดการเอง)",
    });
  }

  // 2) Sales vs 30-day avg
  const valid = input.history30dTotals.filter((n) => n > 0);
  if (valid.length >= 5) {
    const avg = valid.reduce((s, n) => s + n, 0) / valid.length;
    const ratio = avg > 0 ? input.totalSales / avg : 1;
    if (ratio >= 0.5 && ratio <= 1.5) {
      checks.push({
        label: "ยอด vs เฉลี่ย",
        status: "pass",
        detail: `${(ratio * 100).toFixed(0)}% (avg ฿${formatCompact(avg)})`,
      });
    } else if (ratio >= 0.4 && ratio <= 1.6) {
      checks.push({
        label: "ยอด vs เฉลี่ย",
        status: "warn",
        detail: `${(ratio * 100).toFixed(0)}% — ห่างจากเฉลี่ย`,
      });
    } else {
      checks.push({
        label: "ยอด vs เฉลี่ย",
        status: "fail",
        detail: `${(ratio * 100).toFixed(0)}% — ผิดปกติ ตรวจดูอีกครั้ง`,
      });
    }
  } else {
    checks.push({
      label: "ยอด vs เฉลี่ย",
      status: "warn",
      detail: "ข้อมูลไม่พอ (< 5 วัน)",
    });
  }

  // 3) Off-hours submission (00:00–05:00)
  if (input.submittedAt) {
    const h = new Date(input.submittedAt).getHours();
    if (h >= 0 && h < 5) {
      checks.push({
        label: "เวลาส่ง",
        status: "warn",
        detail: `ส่งตอน ${String(h).padStart(2, "0")}:xx (ผิดเวลาปกติ)`,
      });
    } else {
      checks.push({
        label: "เวลาส่ง",
        status: "pass",
        detail: "ปกติ",
      });
    }
  }

  // 4) Spike check (> 1.5× avg)
  if (valid.length >= 5) {
    const avg = valid.reduce((s, n) => s + n, 0) / valid.length;
    if (avg > 0 && input.totalSales > avg * 1.5) {
      checks.push({
        label: "Spike Alert",
        status: "warn",
        detail: `สูงกว่าเฉลี่ย +${(((input.totalSales - avg) / avg) * 100).toFixed(0)}%`,
      });
    }
  }

  // 5) Shift completeness (multi-shift only)
  if (input.todayOtherShifts && input.todayOtherShifts.length > 0) {
    const missing = input.todayOtherShifts.filter(
      (s) => s.status === "missing",
    ).length;
    if (missing > 0) {
      checks.push({
        label: "กะอื่นวันนี้",
        status: "warn",
        detail: `ขาดอีก ${missing} กะ`,
      });
    }
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const passed = !hasFail;
  const summary = hasFail
    ? `❌ ติด ${checks.filter((c) => c.status === "fail").length} จุด`
    : hasWarn
      ? `⚠️ น่าสังเกต ${checks.filter((c) => c.status === "warn").length} จุด`
      : "✅ ผ่านทั้งหมด";
  return { passed, checks, summary };
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString("th-TH");
}
