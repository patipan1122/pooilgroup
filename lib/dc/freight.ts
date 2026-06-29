// DC คลังกลาง · คิดค่าขนส่งจีน-ไทย อัตโนมัติจาก CBM × เรตต่อคิว (m³) แยกรถ/เรือ
//   (#4 · CEO 2026-06-29 — "ค่าของจ่ายตอนซื้อแล้ว · ที่ต้องจ่ายคือค่าขนส่ง คิดจาก CBM")
//
// ⚠️ PURE — ห้าม import prisma/server-only ที่นี่ (client component import ได้)
//    per [[nextjs-client-import-prisma-constants-boundary]]

/** เรตค่าขนส่งต่อ 1 คิว (m³) — หน่วยสตางค์ (×100 ของบาท) แยกตามวิธีส่ง */
export type FreightRates = { TRUCK: number; SEA: number };

export const ZERO_FREIGHT_RATES: FreightRates = { TRUCK: 0, SEA: 0 };

/** ตั้งเรตแล้วหรือยัง (อย่างน้อย 1 วิธี > 0) */
export function freightRatesSet(rates: FreightRates): boolean {
  return rates.TRUCK > 0 || rates.SEA > 0;
}

/** ค่าขนส่งของกล่อง/ชิปเมนต์ 1 ใบ = cbm × เรตของวิธีนั้น (สตางค์ · ปัดเศษ) */
export function freightForBox(
  cbm: number | null | undefined,
  mode: "TRUCK" | "SEA",
  rates: FreightRates,
): number {
  const c = typeof cbm === "number" && cbm > 0 ? cbm : 0;
  const rate = mode === "SEA" ? rates.SEA : rates.TRUCK;
  return Math.round(c * rate);
}

export type FreightBox = {
  cbmTotal: number | null;
  mode: "TRUCK" | "SEA";
  /** ยอดค่าขนส่งเดิมที่เคยกรอกมือไว้ (ใช้ fallback เมื่อยังไม่ตั้งเรต) */
  chinaFreightThbSatang?: number;
  intlFreightThbSatang?: number;
};

/**
 * ค่าขนส่งรวมของใบสั่งซื้อ (สตางค์).
 *  - ตั้งเรตแล้ว → คิดอัตโนมัติ Σ(cbm × เรต) ตามที่ CEO เลือก
 *  - ยังไม่ตั้งเรต → fallback ใช้ยอด freight เดิมที่กรอกในกล่อง (กันยอดเก่ากลายเป็น 0)
 */
export function computePoFreightSatang(boxes: FreightBox[], rates: FreightRates): number {
  if (freightRatesSet(rates)) {
    return boxes.reduce((s, b) => s + freightForBox(b.cbmTotal, b.mode, rates), 0);
  }
  return boxes.reduce(
    (s, b) => s + (b.chinaFreightThbSatang ?? 0) + (b.intlFreightThbSatang ?? 0),
    0,
  );
}
