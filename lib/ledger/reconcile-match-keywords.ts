// LedgerLine — หลักการแมตช์ยอด: "ป้ายชื่อ 2 ฝั่งให้ตรงกัน" (pure · server/client ใช้ได้)
//
// แนวคิด (CEO 2026-06-15): ฝั่งบัญชี (book) ทุกบรรทัดมี "ประเภท/ช่องทาง" อยู่แล้ว
// (payment_channel เช่น "Grab" / "ShopeeFood" / "เครดิต EDC" / "เงินสด").
// ฝั่งธนาคารมี "ชื่อคู่ค้า" ในข้อความ (ref2/description เช่น "บจก. แกร็บแท็กซี่").
// เราจับคู่ด้วยการ map ทั้งสองฝั่งเข้า "concept" เดียวกัน แล้วยืนยันด้วยวัน + ยอด.
//
// concept = กลุ่มช่องทางที่ระบบรู้จัก · แต่ละ concept บอกว่า
//   - ต้องเช็คชื่อไหม (requireName) — เงินสดไม่ต้อง (ไม่มีชื่อเฉพาะ)
//   - คำหลัก (keywords) ที่ควรเจอในข้อความฝั่งธนาคาร
//   - หน้าต่างวัน (dateWindowDays) — Grab/Shopee เข้า T+1 · เงินสดฝากช้าได้หลายวัน
//   - ช่วงเผื่อยอด (ค่าธรรมเนียมแกว่ง) — name-lock กันจับผิด เลยเผื่อยอดได้กว้าง
//
// ตัวเลขค่าธรรมเนียมจริง (verified จาก statement 0886 · เม.ย.–มิ.ย. 2026):
//   Grab = 16.00% เป๊ะ (T+1) · Shopee = 16.05% เป๊ะ (= 15% + VAT 7% · แต่ฝากไม่ตรงวัน lag +1..+3) · EDC ~0.9% · QR/เงินสด 0%
//   → Shopee ต้องเผื่อ "วัน" กว้าง (ฝากช้า) ไม่ใช่เผื่อ "ยอด" (ยอดสุทธิเป๊ะแล้วหลังตั้ง fee 16.05)

export interface MatchConcept {
  key: string;             // grab · shopee · lineman · card · qr · cash · other
  label: string;
  keywords: string[];      // คำหลัก (lowercase) ที่ควรเจอใน ref2/description ฝั่งธนาคาร
  requireName: boolean;    // ต้องเจอ keyword ก่อนถึงจับ (false = เงินสด/อื่น ใช้ยอด+วันพอ)
  dateWindowDays: number;  // |วันธนาคาร − วันบัญชี| ต้อง ≤ ค่านี้
  tolAbsSatang: number;    // เผื่อยอดขั้นต่ำ (สตางค์)
  tolPct: number;          // เผื่อยอด = สัดส่วนของยอดบัญชี (เช่น 0.03 = 3%)
}

// concept มาตรฐาน (seed) — หน้าสมุดจำคีย์ (เฟสหน้า) จะเพิ่ม keyword ราย-บัญชีทับได้
export const MATCH_CONCEPTS: Record<string, MatchConcept> = {
  grab:    { key: "grab",    label: "Grab",      keywords: ["แกร็บ", "grab"],                      requireName: true,  dateWindowDays: 2, tolAbsSatang: 1500, tolPct: 0.03 },
  shopee:  { key: "shopee",  label: "ShopeeFood", keywords: ["ช้อปปี้เพย์", "ช้อปปี้", "shopee"],  requireName: true,  dateWindowDays: 5, tolAbsSatang: 2000, tolPct: 0.05 },
  lineman: { key: "lineman", label: "Lineman",   keywords: ["ไลน์แมน", "lineman"],                 requireName: true,  dateWindowDays: 3, tolAbsSatang: 1500, tolPct: 0.05 },
  card:    { key: "card",    label: "บัตร/EDC",   keywords: ["amz_sd", "ผ่อนชำระ"],                 requireName: true,  dateWindowDays: 2, tolAbsSatang: 500,  tolPct: 0.02 },
  qr:      { key: "qr",      label: "QR",        keywords: ["thai qr payment", "qr payment", "qr", "พร้อมเพย์", "promptpay"], requireName: true, dateWindowDays: 2, tolAbsSatang: 100, tolPct: 0 },
  cash:    { key: "cash",    label: "เงินสด",     keywords: ["ฝากเงินสด"],                          requireName: false, dateWindowDays: 7, tolAbsSatang: 100,  tolPct: 0 },
  other:   { key: "other",   label: "อื่น ๆ",     keywords: [],                                     requireName: false, dateWindowDays: 2, tolAbsSatang: 100,  tolPct: 0 },
};

// map ช่องทางฝั่งบัญชี (payment_channel label) → concept
export function conceptForChannel(channel: string | null | undefined): MatchConcept {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("แกร็บ") || c.includes("grab")) return MATCH_CONCEPTS.grab;
  if (c.includes("ช้อปปี้") || c.includes("shopee")) return MATCH_CONCEPTS.shopee;
  if (c.includes("ไลน์แมน") || c.includes("lineman")) return MATCH_CONCEPTS.lineman;
  if (c.includes("edc") || c.includes("บัตร") || c.includes("เครดิต") || c.includes("card")) return MATCH_CONCEPTS.card;
  if (c.includes("qr")) return MATCH_CONCEPTS.qr;
  if (c.includes("เงินสด") || c.includes("cash")) return MATCH_CONCEPTS.cash;
  return MATCH_CONCEPTS.other;
}

// ฝั่งธนาคาร: ข้อความรวม (ref2 + description + channel, lowercase) ผ่านเงื่อนไขชื่อของ concept ไหม
// extraKeywords = คำหลักที่ "เรียนรู้" มาเพิ่มราย-บัญชี (เฟสหน้า) — Phase 1 ส่ง [] มา
export function bankNameMatches(
  concept: MatchConcept,
  bankTextLower: string,
  extraKeywords: string[] = [],
): boolean {
  if (!concept.requireName) return true; // เงินสด/อื่น = ไม่บังคับชื่อ
  const kws = [...concept.keywords, ...extraKeywords];
  return kws.some((k) => k && bankTextLower.includes(k.toLowerCase()));
}

// เผื่อยอด (สตางค์) สำหรับยอดบัญชีก้อนนี้ = max(ขั้นต่ำ, ยอด × tolPct)
export function amountToleranceSatang(concept: MatchConcept, bookAmountSatang: number): number {
  return Math.max(concept.tolAbsSatang, Math.round(Math.abs(bookAmountSatang) * concept.tolPct));
}
