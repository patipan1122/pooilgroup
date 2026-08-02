// Client-safe contract constants (no node:crypto) — imported by both the maid
// signing UI (client) and the hash lib / server actions.

// เปลี่ยนเมื่อข้อความสัญญา (ContractDocument ข้อ 1–5) ถูกแก้ — hash เก่ายังพิสูจน์
// เวอร์ชันที่เซ็นจริงได้.
export const CONTRACT_TERMS_VERSION = "2026-07-12";

// ประโยคยินยอมที่ผู้รับจ้างต้องติ๊กก่อนเซ็น (เก็บเป็นหลักฐานว่ายินยอมอะไร).
export const CONTRACT_CONSENT_TEXT =
  "ข้าพเจ้าได้อ่านและเข้าใจสัญญาฉบับนี้โดยละเอียดแล้ว และยินยอมลงลายมือชื่อทางอิเล็กทรอนิกส์ผูกพันตามสัญญานี้";
