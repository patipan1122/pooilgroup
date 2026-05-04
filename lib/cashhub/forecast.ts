// Simple end-of-month forecast.
// "ง่ายๆ ก่อน" — daily-average × days-remaining + actual to date.
// Smarter (seasonality, day-of-week) can swap in later behind the same shape.

export interface ForecastInput {
  /** Sales actually recorded so far this month (approved + submitted) */
  actualMtd: number;
  /** Days elapsed in the month (1..31) */
  daysElapsed: number;
  /** Total days in the current month */
  daysInMonth: number;
  /** Optional: prior-month total for "vs prev" framing */
  prevMonthTotal?: number;
}

export interface ForecastResult {
  /** Average per elapsed day */
  dailyAvg: number;
  /** Forecast end-of-month total */
  forecastEom: number;
  /** Days remaining */
  daysLeft: number;
  /** % change vs prev month, or null when not provided */
  vsPrevPct: number | null;
}

export function forecast(input: ForecastInput): ForecastResult {
  const { actualMtd, daysElapsed, daysInMonth, prevMonthTotal } = input;
  const safeElapsed = Math.max(1, daysElapsed);
  const dailyAvg = actualMtd / safeElapsed;
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);
  const forecastEom = actualMtd + dailyAvg * daysLeft;
  const vsPrevPct =
    prevMonthTotal && prevMonthTotal > 0
      ? ((forecastEom - prevMonthTotal) / prevMonthTotal) * 100
      : null;
  return { dailyAvg, forecastEom, daysLeft, vsPrevPct };
}

/**
 * Target progress — "are we on track at this point in the month?"
 * Returns a ratio against the proportional target (e.g., day 15/30 expects 50%).
 */
export function targetProgress({
  target,
  actual,
  daysElapsed,
  daysInMonth,
}: {
  target: number;
  actual: number;
  daysElapsed: number;
  daysInMonth: number;
}): {
  expectedSoFar: number;
  pctOfTotal: number;
  pctOfPace: number;
  isOnTrack: boolean;
  shortfallToPace: number;
  remainingPerDay: number;
} {
  if (target <= 0) {
    return {
      expectedSoFar: 0,
      pctOfTotal: 0,
      pctOfPace: 0,
      isOnTrack: false,
      shortfallToPace: 0,
      remainingPerDay: 0,
    };
  }
  const expectedSoFar = (target * daysElapsed) / Math.max(1, daysInMonth);
  const pctOfTotal = (actual / target) * 100;
  const pctOfPace = expectedSoFar > 0 ? (actual / expectedSoFar) * 100 : 0;
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);
  const remainingPerDay = daysLeft > 0 ? Math.max(0, target - actual) / daysLeft : 0;
  return {
    expectedSoFar,
    pctOfTotal,
    pctOfPace,
    isOnTrack: pctOfPace >= 95,
    shortfallToPace: Math.max(0, expectedSoFar - actual),
    remainingPerDay,
  };
}
