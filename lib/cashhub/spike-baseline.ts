// Rolling 7-day median baseline for CashHub spike alert.
//
// 2026-05-20: Branch Manager persona audit ระบุว่า "เทียบเมื่อวาน × 1.5"
// false-positive ทุกเสาร์-อาทิตย์ (วันหยุดยอดต่ำ → เด้งทุกวันจันทร์).
// แก้: ใช้ rolling 7-day median แทน yesterday → robust ต่อ outlier/weekend.
//
// Pure function · ไม่แตะ DB · unit-testable.

export interface DailyReportRow {
  report_date: string;
  total_sales: number | string | null;
}

export interface SpikeBaseline {
  totalSales: number;  // The median (baseline for ×1.5 spike check)
  sampleDays: number;  // จำนวนวันที่มี data > 0 (ใช้ตัดสินว่า baseline เชื่อถือได้แค่ไหน)
}

/**
 * Compute rolling 7-day median total_sales from a set of daily_reports rows.
 *
 * - Sums shifts on the same date (so multi-shift branches don't undercount)
 * - Skips days with 0 sales (closed day · holiday → ไม่ใช้เป็น baseline)
 * - Median = 50th percentile (n odd) หรือ avg ของ 2 ค่ากลาง (n even)
 *
 * Returns null if no qualifying data (sample too small to trust).
 * Caller should fall back to "เมื่อวาน" reference in that case.
 */
export function computeSpikeBaseline(
  reports: DailyReportRow[],
): SpikeBaseline | null {
  // Group by date and sum across shifts
  const dailyTotals = new Map<string, number>();
  for (const r of reports) {
    const sum = Number(r.total_sales ?? 0);
    if (!Number.isFinite(sum)) continue;
    dailyTotals.set(r.report_date, (dailyTotals.get(r.report_date) ?? 0) + sum);
  }

  // Skip days with zero sales (closed / no operation)
  const values = Array.from(dailyTotals.values())
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (values.length === 0) return null;

  // Need at least 3 sample days for median to be meaningful
  if (values.length < 3) return null;

  const median =
    values.length % 2 === 1
      ? values[Math.floor(values.length / 2)]
      : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;

  return {
    totalSales: median,
    sampleDays: values.length,
  };
}
