// Person doc types ที่ track ในระบบ — shared across persons list + detail
// ทุกคนต้องมี id_card อย่างน้อย; license/health/training สำคัญสำหรับ driver

export const PERSON_DOC_TYPES = [
  "license",
  "training",
  "health",
  "id_card",
] as const;

export type PersonDocType = (typeof PERSON_DOC_TYPES)[number];

export const PERSON_DOC_TYPE_LABEL: Record<string, string> = {
  license: "ใบขับขี่",
  training: "ใบรับรองอบรม",
  health: "ใบรับรองสุขภาพ",
  id_card: "บัตรประชาชน",
  other: "อื่นๆ",
};

export const PERSON_DOC_TYPE_HINT: Record<string, string> = {
  license: "พนักงานขับรถต้องมี · ตรวจวันหมดอายุก่อนออกงาน",
  training: "ใบรับรองหลักสูตรขนส่ง / กม. ความปลอดภัย",
  health: "ใบรับรองแพทย์ — ต่ออายุปีละครั้ง",
  id_card: "บัตรประชาชน — ใช้สำหรับยืนยันตัวตน",
};
