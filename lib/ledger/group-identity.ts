// LedgerLine — group identity SSoT (ภาษีซื้อ buyer verification).
//
// The single source of truth for "who is OUR buyer" when grading an input-VAT
// invoice. The whole anti-false-accept guarantee rests on deciding by the 13-digit
// tax id EXACTLY — never the name and never OCR confidence (which has hallucinated
// "เจพีซิ้งค์" → "เจพีชิปปิ้ง" @0.95). Pure module: no DB / no I/O — safe to import
// from the deterministic engine (recheck.ts), server actions, and the AI prompt.

/** ผู้ซื้อหลัก = เจพีซิ้งค์ กรุ๊ป. Master snapshot stamped onto each expense. */
export const OUR_BUYER = {
  taxId: "0305564001581",
  name: "บริษัท เจพีซิ้งค์ กรุ๊ป จำกัด",
  address: "112 หมู่10 ต.จักราช อ.จักราช จ.นครราชสีมา 30230",
} as const;

/**
 * เลขภาษีของบริษัทในเครือทั้งหมด. ใบที่จ่ายโดยเจพีซิ้งค์ แต่ออกชื่อบริษัทเครืออื่น
 * = ขอคืนไม่ได้ (wrong_entity) → ใช้ set นี้แยก "เครือแต่ผิดบริษัท" ออกจาก "นอกเครือ".
 * TODO: รับ whitelist เครือเต็ม (15 บริษัทใน TRCloud) จาก CEO แล้วเติมที่นี่ (Open#2).
 */
export const GROUP_TAX_IDS = new Set<string>([
  OUR_BUYER.taxId, // 0305564001581 — เจพีซิ้งค์
]);

/** เก็บเฉพาะตัวเลข (ตัดเว้นวรรค/ขีด/ตัวอักษรทิ้ง) เพื่อเทียบเลขภาษี 13 หลัก. */
export function stripTaxId(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/** ผู้ซื้อ === เจพีซิ้งค์ (เทียบเลข 13 หลักเป๊ะหลัง strip). */
export function isOurBuyer(taxId: string | null | undefined): boolean {
  return stripTaxId(taxId) === OUR_BUYER.taxId;
}

/** เลขภาษีนี้อยู่ในเครือไหม (เจพีซิ้งค์ หรือบริษัทเครืออื่นใน whitelist). */
export function isGroupEntity(taxId: string | null | undefined): boolean {
  return GROUP_TAX_IDS.has(stripTaxId(taxId));
}
