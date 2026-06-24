// Playland · ค่าปรับเกินเวลา (overtime) — pure helpers
//
// CEO decision 2026-06-24: เวลาหมดแล้ว "เวลาไม่หยุด" — รันต่อไปเรื่อย ๆ จนกว่าจะกดเช็คเอาท์
// แล้วเก็บ "ค่าปรับเกินเวลา" เพิ่มตอนเช็คเอาท์ (ไม่ตัด/ไม่ริบอัตโนมัติ).
//
// ไฟล์นี้ pure (ไม่มี prisma/server) → import ได้ทั้งฝั่ง server action และ client SPA
// เพื่อให้ "เลขที่โชว์หน้าจอ" กับ "เลขที่เก็บเงินจริง" ใช้สูตรเดียวกัน.

/** ค่าปรับเกินเวลา default = ฿2/นาที (200 สตางค์) · สาขาตั้งทับได้ใน branch.settings.overtimeRatePerMinuteCents */
export const DEFAULT_OVERTIME_RATE_PER_MIN_CENTS = 200;

/** อ่าน rate ต่อสาขาจาก branch.settings (JSON) · fallback = default */
export function readOvertimeRate(settings: unknown): number {
  if (settings && typeof settings === "object" && "overtimeRatePerMinuteCents" in settings) {
    const v = (settings as Record<string, unknown>).overtimeRatePerMinuteCents;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100_000) return Math.round(v);
  }
  return DEFAULT_OVERTIME_RATE_PER_MIN_CENTS;
}

/** server-authoritative: คิดจาก expiresAt จริง (กันลูกค้าปลอม sec ฝั่ง client) */
export function overtimeFromExpiry(
  packageMinutes: number,
  expiresAt: Date | null,
  now: Date,
  ratePerMinCents: number,
): { minutes: number; cents: number } {
  if (packageMinutes <= 0 || !expiresAt) return { minutes: 0, cents: 0 }; // day pass / ไม่มีหมดเวลา = ไม่มีค่าปรับ
  const overMs = now.getTime() - expiresAt.getTime();
  if (overMs <= 0) return { minutes: 0, cents: 0 };
  const minutes = Math.ceil(overMs / 60_000);
  return { minutes, cents: minutes * ratePerMinCents };
}

/** client display: คิดจากวินาทีที่เหลือ (sec ติดลบ = เกินเวลา) — โชว์ให้แคชเชียร์เห็นก่อนกดเก็บเงิน */
export function overtimeFromSec(sec: number, ratePerMinCents: number): { minutes: number; cents: number } {
  if (sec >= 0) return { minutes: 0, cents: 0 };
  const minutes = Math.ceil(-sec / 60);
  return { minutes, cents: minutes * ratePerMinCents };
}
