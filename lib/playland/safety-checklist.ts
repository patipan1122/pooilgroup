// Playland · เช็กลิสต์ "ความปลอดภัย" — pure helpers (ไม่มี prisma/server)
//
// ไฟล์นี้ pure → import ได้ทั้งฝั่ง client form (safety-form.tsx) และ server
// (page.tsx / safety.ts) เพื่อให้ "default ที่โชว์" กับ "ค่าที่อ่าน/บันทึก" ใช้ชุดเดียวกัน.
//
// validated-reader pattern เดียวกับ lib/playland/overtime.ts (readOvertimeRate):
// อ่านจาก branch.settings.safetyChecklist (string[]) ถ้ามี & non-empty, ไม่งั้น fallback default.

/** เช็กลิสต์ "ความปลอดภัย" default — สาขาตั้งทับได้ใน branch.settings.safetyChecklist */
export const DEFAULT_SAFETY_ITEMS: string[] = [
  "น็อต/สกรูเครื่องเล่นแน่น",
  "ตาข่าย/กันชนไม่ขาด",
  "พื้น/เบาะนุ่มไม่ฉีก",
  "บอลพิทสะอาดไม่มีของแหลม",
  "ทางออกฉุกเฉินไม่มีของกีดขวาง",
  "ถังดับเพลิงพร้อมใช้",
  "ชุดปฐมพยาบาลครบ",
];

/** กันรายการบาน + ป้องกัน abuse: ≤ 40 ข้อ, แต่ละข้อ ≤ 120 ตัวอักษร */
export const MAX_SAFETY_ITEMS = 40;
export const MAX_SAFETY_ITEM_LEN = 120;

/** trim · ตัดข้อว่าง · cap ความยาว · cap จำนวน — ใช้ทั้งตอนอ่านและตอนบันทึก */
export function sanitizeSafetyChecklist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().slice(0, MAX_SAFETY_ITEM_LEN))
    .filter((s) => s.length > 0)
    .slice(0, MAX_SAFETY_ITEMS);
}

/** อ่านเช็กลิสต์ความปลอดภัยต่อสาขาจาก branch.settings (JSON) · fallback = DEFAULT_SAFETY_ITEMS */
export function readSafetyChecklist(settings: unknown): string[] {
  if (settings && typeof settings === "object" && "safetyChecklist" in settings) {
    const cleaned = sanitizeSafetyChecklist((settings as Record<string, unknown>).safetyChecklist);
    if (cleaned.length > 0) return cleaned;
  }
  return DEFAULT_SAFETY_ITEMS;
}
