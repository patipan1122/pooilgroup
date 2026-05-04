// Branch Health Score (A-F) — CASHHUB §9 algorithm
// Pure function so it can be called from cron (server) or seed (server) safely.
// Score starts at 100, mutated by signals from the last 30 days of operation.

export interface HealthInput {
  /** Days the branch is expected to fill (working days in window) — typically 30 */
  expectedDays: number;
  /** Number of days actually reported in window */
  reportedDays: number;
  /** Reports submitted on or before deadline */
  onTimeDays: number;
  /** Reports where reconcile balanced exactly */
  balancedDays: number;
  /** Reports flagged with > 1% diff (not blocked but needs note) */
  diffOnePctDays: number;
  /** Reports outright blocked > 5% diff */
  diffFivePctDays: number;
  /** Total sales in window */
  totalSales: number;
  /** Same window in previous 30-day period (for growth comparison) */
  prevTotalSales: number;
  /** This-month target (proportional to elapsed days) */
  targetThisMonth: number;
  /** Actual sales this month (used for target progress) */
  actualThisMonth: number;
  /** Days into the month (1..31) — used to scale target progress */
  daysIntoMonth: number;
  /** Days in this month */
  daysInMonth: number;
  /** Consecutive declining-vs-prior-day count for the latest run */
  consecutiveDeclineDays: number;
}

export interface HealthResult {
  score: number; // 0-100 (clamped)
  grade: "A" | "B" | "C" | "D" | "E" | "F";
  breakdown: Array<{ label: string; delta: number; reason: string }>;
}

export function computeHealth(input: HealthInput): HealthResult {
  let score = 100;
  const breakdown: HealthResult["breakdown"] = [];
  const note = (label: string, delta: number, reason: string) => {
    score += delta;
    breakdown.push({ label, delta, reason });
  };

  // Fill rate (most heavily weighted)
  const missing = Math.max(0, input.expectedDays - input.reportedDays);
  if (missing === 0 && input.expectedDays >= 30) {
    note("ครบทุกวัน", +10, "กรอกครบ 30 วันไม่ขาด");
  } else if (missing > 0) {
    note(`ขาด ${missing} วัน`, -10 * Math.min(missing, 3), `ไม่กรอก ${missing} วัน × -10`);
  }

  // Punctuality
  if (input.reportedDays > 0) {
    const onTimeRate = input.onTimeDays / input.reportedDays;
    if (onTimeRate >= 0.95) {
      note("กรอกตรงเวลา", +5, `${(onTimeRate * 100).toFixed(0)}% ทันก่อน Deadline`);
    } else if (onTimeRate < 0.7) {
      note("กรอกหลัง Deadline บ่อย", -5, `${(onTimeRate * 100).toFixed(0)}% ทันก่อน Deadline`);
    }
  }

  // Reconcile health
  if (input.reportedDays > 0) {
    const balancedRate = input.balancedDays / input.reportedDays;
    if (balancedRate >= 0.95) {
      note("ยอดตรงทุกวัน", +5, "Reconcile ตรงพอดี ไม่มี Diff");
    }
  }
  if (input.diffOnePctDays > 0) note("Diff 1%", -5, `${input.diffOnePctDays} วัน`);
  if (input.diffFivePctDays > 0)
    note("Diff 5% ถูก Block", -10, `${input.diffFivePctDays} วัน`);

  // Sales trend
  if (input.prevTotalSales > 0) {
    const growth = (input.totalSales - input.prevTotalSales) / input.prevTotalSales;
    if (growth >= 0.05) {
      note("ยอดเติบโต", +5, `+${(growth * 100).toFixed(1)}% เทียบ 30 วันก่อน`);
    } else if (growth < -0.1) {
      note("ยอดลด", -5, `${(growth * 100).toFixed(1)}% เทียบ 30 วันก่อน`);
    }
  }
  if (input.consecutiveDeclineDays >= 3) {
    note("ยอดลดต่อเนื่อง", -15, `${input.consecutiveDeclineDays} วันติด`);
  }

  // Target progress (scaled to elapsed days)
  if (input.targetThisMonth > 0 && input.daysInMonth > 0) {
    const expectedSoFar =
      input.targetThisMonth * (input.daysIntoMonth / input.daysInMonth);
    const ratio = expectedSoFar > 0 ? input.actualThisMonth / expectedSoFar : 0;
    if (ratio >= 0.9) {
      note("ใกล้/ถึงเป้า", +5, `${(ratio * 100).toFixed(0)}% ของเป้าตามสัดส่วน`);
    } else if (ratio < 0.6) {
      note("ห่างจากเป้ามาก", -10, `${(ratio * 100).toFixed(0)}% ของเป้าตามสัดส่วน`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const grade =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : score >= 30 ? "E" : "F";
  return { score, grade, breakdown };
}

export const GRADE_TONE: Record<HealthResult["grade"], "success" | "info" | "warning" | "danger" | "neutral"> = {
  A: "success",
  B: "success",
  C: "info",
  D: "warning",
  E: "warning",
  F: "danger",
};

export const GRADE_STARS: Record<HealthResult["grade"], string> = {
  A: "⭐⭐⭐⭐⭐",
  B: "⭐⭐⭐⭐",
  C: "⭐⭐⭐",
  D: "⭐⭐",
  E: "⭐",
  F: "",
};

export const GRADE_COLOR_HEX: Record<HealthResult["grade"], string> = {
  A: "#16a34a",
  B: "#059669",
  C: "#0284c7",
  D: "#d97706",
  E: "#ea580c",
  F: "#dc2626",
};
