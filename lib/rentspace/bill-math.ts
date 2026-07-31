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
 * base (commercial rent / utilities per config), not on pass-through items.
 *
 * ส่วนลดหักจาก "ยอดที่ยกเว้น VAT ก่อน" (ค่าเช่าอสังหาฯ / ภาษีส่งผ่าน / อื่น ๆ)
 * แล้วจึงจะไปลดฐาน VAT เฉพาะ "ส่วนที่เกิน" ยอดยกเว้นเท่านั้น. เดิมเคยเฉลี่ยส่วนลด
 * แบบสัดส่วน (proportional) ทำให้ "ส่วนลดค่าเช่า" (ที่ไม่มี VAT อยู่แล้ว) ไปกิน
 * ฐานภาษีของค่าไฟ → output VAT ที่ต้องนำส่งสรรพากรต่ำกว่าจริง = เก็บภาษีขาด.
 * วิธี exempt-first นี้ปลอดภัยเชิงภาษี: จะไม่ทำให้ฐาน VAT ต่ำกว่าความจริง เว้นแต่
 * ส่วนลดมากจนล้นยอดยกเว้นทั้งหมด (ซึ่งตอนนั้นการลดฐาน VAT เป็นเรื่องถูกต้อง).
 * Pure (no DB) so a freshly-created bill and a recomputed bill agree exactly.
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
  // หักส่วนลดจากยอด "ยกเว้น VAT" ก่อน (gross − vatableGross) → ส่วนลดจะไปลดฐาน VAT
  // เฉพาะ "ส่วนที่เกิน" ยอดยกเว้นเท่านั้น. กันเคสส่วนลดค่าเช่าไปกินฐานภาษีค่าไฟ.
  const exemptGross = Math.max(0, round2(gross - vatableGross));
  const discountOnVatable = Math.max(0, round2(discountAmount - exemptGross));
  const vatableNet = Math.max(0, round2(vatableGross - discountOnVatable));
  const vatAmount = round2(vatableNet * (args.vatPercent / 100));
  const subtotal = Math.max(0, round2(gross - discountAmount));
  const totalAmount = round2(subtotal + vatAmount);
  return { gross, discountAmount, subtotal, vatAmount, totalAmount };
}
