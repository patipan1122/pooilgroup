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

/** Support phone for the chatbot / FAQ. */
export const SUPPORT_PHONE = "084-198-1623";
