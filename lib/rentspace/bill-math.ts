// RentSpace — bill money math (PURE · prisma-free · client-safe).
// เดิมสูตรนี้อยู่ใน lib/rentspace/billing.ts (server-only เพราะ import prisma).
// ย้ายมาไว้ที่นี่เพื่อให้ทั้ง server (billing.ts) และ client (พรีวิว/ใบวางบิลแยก)
// ใช้ "สูตรคิด VAT ตัวเดียวกัน" → ยอดบนจอ = ยอดจริง 100% เสมอ ไม่หลุดจากกัน.
// billing.ts re-export ตัวนี้ต่อ (ของเดิมที่ import จาก billing ยังใช้ได้เหมือนเดิม).
import { toNum } from "@/lib/rentspace/format";

/** round to 2 decimals (money). Single source of truth for all bill math. */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Compute discount + subtotal + VAT + total from line items, the approved
 * discount total and the contract VAT %. VAT is charged ONLY on the VATable
 * base (commercial rent / utilities per config), not on pass-through items —
 * and the discount is allocated proportionally across the bill so the VATable
 * share shrinks fairly. Pure (no DB) so a freshly-created bill and a recomputed
 * bill agree exactly.
 */
export function computeBillTotals(args: {
  items: { amount: number; vatable: boolean }[];
  approvedDiscount: number;
  vatPercent: number;
}): { gross: number; discountAmount: number; subtotal: number; vatAmount: number; totalAmount: number } {
  const gross = round2(args.items.reduce((s, it) => s + toNum(it.amount), 0));
  // discount can never exceed the gross (no negative bills)
  const discountAmount = round2(Math.min(Math.max(0, args.approvedDiscount), gross));
  const vatableGross = round2(
    args.items.filter((it) => it.vatable).reduce((s, it) => s + toNum(it.amount), 0),
  );
  // allocate the discount proportionally → only the VATable portion lowers VAT
  const discountOnVatable = gross > 0 ? round2(discountAmount * (vatableGross / gross)) : 0;
  const vatableNet = Math.max(0, round2(vatableGross - discountOnVatable));
  const vatAmount = round2(vatableNet * (args.vatPercent / 100));
  const subtotal = Math.max(0, round2(gross - discountAmount));
  const totalAmount = round2(subtotal + vatAmount);
  return { gross, discountAmount, subtotal, vatAmount, totalAmount };
}
