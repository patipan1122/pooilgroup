// Pure constants · safe to import from both Server and Client components.
export const DAMAGE_CATEGORIES = [
  "ไม่ออน",
  "เบาะขาด",
  "มอเตอร์ไม่ทำงาน",
  "QR ไม่อ่าน",
  "อื่น ๆ",
] as const;

export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];
