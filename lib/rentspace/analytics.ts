// RentSpace — revenue analytics fetchers (RSC only; layout gates access).
import { prisma } from "@/lib/prisma";
import { currentPeriod, prevPeriod, periodLabel, toNum } from "@/lib/rentspace/format";

export type RevenueThisPeriod = {
  period: string;
  billed: number; // Σ totalAmount of non-void bills this period
  collected: number; // Σ paidAmount this period
  outstanding: number; // Σ (totalAmount − paidAmount) of all unpaid bills (incl. prior)
  net: number; // = billed (รวมสุทธิ this period)
};

export type RevenueMonth = {
  period: string;
  label: string;
  billed: number;
  collected: number;
};

export type RevenueAnalytics = {
  thisPeriod: RevenueThisPeriod;
  rolling12: RevenueMonth[]; // oldest → newest, exactly 12 entries
};

/**
 * รายได้ของโครงการ — งวดปัจจุบัน + ย้อนหลัง 12 เดือน
 * scope ทุก query ด้วย orgId AND projectId เสมอ (กันข้อมูลรั่วข้ามบริษัท/โครงการ)
 */
export async function revenueAnalytics(orgId: string, projectId: string): Promise<RevenueAnalytics> {
  const period = currentPeriod();

  // 12 period strings, oldest → newest, ending currentPeriod()
  const periods: string[] = [period];
  for (let i = 1; i < 12; i++) {
    periods.unshift(prevPeriod(periods[0]));
  }

  // ช่วงเดือนปัจจุบันสำหรับ "เก็บได้" แบบ cash-basis (CEO 2026-08-09 · ตาม paidOn ให้ตรงหน้ารับชำระ)
  const [cy, cm] = period.split("-").map(Number);
  const monthStart = new Date(Date.UTC(cy, cm - 1, 1));
  const monthEnd = new Date(Date.UTC(cy, cm, 1));
  const [thisPeriodBills, unpaidBills, windowBills, collectedPayments] = await Promise.all([
    // งวดปัจจุบัน — non-void → billed + net
    prisma.rentalBill.findMany({
      where: { orgId, projectId, period, status: { not: "void" } },
      select: { totalAmount: true, paidAmount: true },
    }),
    // ค้างชำระทั้งหมด (รวมงวดก่อน ๆ) — bills ที่ยังเปิดอยู่
    prisma.rentalBill.findMany({
      where: { orgId, projectId, status: { in: ["issued", "partial", "overdue"] } },
      select: { totalAmount: true, paidAmount: true },
    }),
    // ย้อนหลัง 12 เดือน — query เดียว แล้วค่อย group ใน JS
    prisma.rentalBill.findMany({
      where: { orgId, projectId, period: { in: periods }, status: { not: "void" } },
      select: { period: true, totalAmount: true, paidAmount: true },
    }),
    // เก็บได้เดือนนี้ (cash-basis) = Σ ชำระยืนยันแล้ว ตามวันจ่ายในเดือนนี้
    prisma.rentalPayment.findMany({
      where: { orgId, status: "confirmed", bill: { projectId }, paidOn: { gte: monthStart, lt: monthEnd } },
      select: { amountThb: true },
    }),
  ]);

  const billed = thisPeriodBills.reduce((s, b) => s + toNum(b.totalAmount), 0);
  const collected = collectedPayments.reduce((s, p) => s + toNum(p.amountThb), 0);
  const outstanding = unpaidBills.reduce(
    (s, b) => s + (toNum(b.totalAmount) - toNum(b.paidAmount)),
    0,
  );

  // aggregate the 12-month window by period
  const agg = new Map<string, { billed: number; collected: number }>();
  for (const p of periods) agg.set(p, { billed: 0, collected: 0 });
  for (const b of windowBills) {
    const slot = agg.get(b.period);
    if (!slot) continue; // safety: ignore any period outside the window
    slot.billed += toNum(b.totalAmount);
    slot.collected += toNum(b.paidAmount);
  }

  const rolling12: RevenueMonth[] = periods.map((p) => {
    const slot = agg.get(p) ?? { billed: 0, collected: 0 };
    return { period: p, label: periodLabel(p), billed: slot.billed, collected: slot.collected };
  });

  return {
    thisPeriod: { period, billed, collected, outstanding, net: billed },
    rolling12,
  };
}
