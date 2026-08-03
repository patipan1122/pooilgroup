// ClawHub (JOLLY PLAY) — locked constants + org resolver.
// CEO decisions: 1 แต้ม = 10 บาท · คืนสูงสุด 250฿/ครั้ง · แต้มหมดอายุ 30 วัน · แลกตุ๊กตาเท่านั้น.

/** 1 POINT = 10 BAHT (locked). */
export const POINT_TO_BAHT = 10;

/** Max baht refundable per single claim (auto-approve ceiling). */
export const MAX_REFUND_BAHT = Number(process.env.CLAWHUB_MAX_REFUND_BAHT ?? 250);

/** Points expire this many days after being earned. */
export const POINT_EXPIRE_DAYS = Number(process.env.CLAWHUB_POINT_EXPIRE_DAYS ?? 30);

/** AI vision confidence below this floor → ask the customer to re-photo. */
export const VISION_CONFIDENCE_FLOOR = Number(
  process.env.CLAWHUB_VISION_CONFIDENCE_FLOOR ?? 0.55,
);

/** Brand name shown to customers. */
export const BRAND = "JOLLY PLAY";

/** Support phone (เบอร์หลัก) ที่บอกลูกค้าตอนแรกเสมอ. */
export const SUPPORT_PHONE = "084-198-1623";

/**
 * เบอร์สำรอง — ส่งให้ "เฉพาะเมื่อ" ลูกค้าบ่นว่าโทรเบอร์หลักไม่ติด/ติดต่อไม่ได้
 * (CEO 2026-08-04: "ใช้เบอร์เดิมก่อน ถ้าโทรไม่ติดลูกค้าบ่นรอบสอง ค่อยส่งเบอร์นี้").
 * อย่าโปรยเบอร์นี้ตั้งแต่แรก — สงวนไว้เป็นไม้ตาย.
 */
export const SUPPORT_PHONE_BACKUP = "086-980-1234";

/** เวลาทำการที่เจ้าหน้าที่ดูแชต (บอกลูกค้าเวลาส่งต่อ) — CEO 2026-08-03. */
export const SUPPORT_HOURS = "ทุกวัน 9:00–18:00";
