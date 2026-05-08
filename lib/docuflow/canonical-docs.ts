// CANONICAL DOC SPEC — Static knowledge base per BusinessType
// ────────────────────────────────────────────────────────────────────
// Source of truth: ดีเทลv1/DOCUFLOW.md §3 (lines 80-262)
//
// ใช้ตอบคำถาม AI Search เช่น "โรงบรรจุก๊าซต้องมีใบอนุญาตอะไรบ้าง?"
// แม้ org ยังไม่ได้อัปโหลดเอกสารใดๆ ก็ตอบได้ตามที่กฎหมายกำหนด
//
// ไม่มี orgId scope — รายการนี้เป็นมาตรฐานอุตสาหกรรม/กฎหมาย ไม่ขึ้นกับ tenant
//
// Structure: BUSINESS_TYPE_CANONICAL_DOCS keyed ตาม BusinessTypeKey
// (จาก constants/business-types.ts) + 2 biztype FuelOS (transport/gas_fleet)
// ────────────────────────────────────────────────────────────────────

import type { BusinessTypeKey } from "@/constants/business-types";

/** ความถี่การต่ออายุ — plain Thai labels for UI display */
export type DocFrequency =
  | "ทุกปี"
  | "ทุก 2 ปี"
  | "ทุก 3 ปี"
  | "ทุก 5 ปี"
  | "5-10 ปี"
  | "ตามสัญญา"
  | "ถาวร"
  | "ทุกวัน"
  | "รายเดือน"
  | "ตลอด"
  | "เมื่อมีเหตุ";

/** ระดับอันตราย/ความสำคัญ — ใช้ guide ผู้บริหารว่าเอกสารไหนต้องโฟกัส */
export type DocDangerLevel = "critical" | "high" | "medium" | "low";

/** ประเภทเอกสาร — ใช้ icon/group ใน UI */
export type DocCategory =
  | "license" // 📋 ใบอนุญาต/ใบรับรอง (ต่ออายุ)
  | "permanent" // 📁 เอกสารถาวร (โฉนด, สัญญาเช่า, แบบแปลน)
  | "form" // 📝 แบบฟอร์ม/บันทึก (รายงาน, log)
  | "personnel"; // 🧑‍💼 ใบรับรองบุคลากร

export interface CanonicalDocSpec {
  /** ชื่อเอกสารตามที่กฎหมายเรียก (ภาษาไทย) */
  name: string;
  /** รอบต่ออายุ */
  frequency: DocFrequency;
  /** หน่วยงานที่ออก/กำกับ (ภาษาไทย) — null สำหรับเอกสารภายใน */
  regulator: string | null;
  /** ความสำคัญ — แสดงผลและ default ลำดับการแจ้งเตือน */
  dangerLevel: DocDangerLevel;
  /** กลุ่มเอกสาร (license / permanent / form / personnel) */
  category: DocCategory;
  /** คำอธิบายสั้น — ช่วย AI ตอบคำถามและช่วย admin เลือก template ตอนอัปโหลด */
  description: string;
}

/* ============================================================
   ⛽ fuel_station — ปั๊มน้ำมัน (DOCUFLOW.md §3 lines 82-102)
   ============================================================ */

const FUEL_STATION_DOCS: CanonicalDocSpec[] = [
  // ใบอนุญาต/ต่ออายุ
  {
    name: "ใบอนุญาตสถานีบริการน้ำมัน",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักประกอบกิจการสถานีบริการน้ำมันเชื้อเพลิง",
  },
  {
    name: "ใบอนุญาตประกอบธุรกิจค้าน้ำมัน",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตค้าน้ำมันเชื้อเพลิงตาม พ.ร.บ.การค้าน้ำมันเชื้อเพลิง",
  },
  {
    name: "ใบอนุญาตสิ่งแวดล้อม (EIA)",
    frequency: "ทุก 5 ปี",
    regulator: "สำนักงานนโยบายและแผนทรัพยากรธรรมชาติและสิ่งแวดล้อม",
    dangerLevel: "high",
    category: "license",
    description: "รายงานการวิเคราะห์ผลกระทบสิ่งแวดล้อม",
  },
  {
    name: "ใบรับรองถังน้ำมันใต้ดิน",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสภาพถังน้ำมันใต้ดินทุก 5 ปี",
  },
  {
    name: "ใบรับรองเครื่องจ่ายน้ำมัน",
    frequency: "ทุกปี",
    regulator: "กรมการขนส่งทางบก/กรมทดสอบ",
    dangerLevel: "medium",
    category: "license",
    description: "ตรวจมาตรฐานหัวจ่ายน้ำมันประจำปี",
  },
  {
    name: "ใบรับรองมาตรชั่งตวงวัด",
    frequency: "ทุกปี",
    regulator: "สำนักชั่งตวงวัด",
    dangerLevel: "medium",
    category: "license",
    description: "ตรวจสอบความถูกต้องของหัวจ่ายตามมาตรฐานชั่งตวงวัด",
  },
  {
    name: "ใบรับรองระบบดับเพลิง",
    frequency: "ทุกปี",
    regulator: "กรมป้องกันและบรรเทาสาธารณภัย",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจอุปกรณ์ดับเพลิงและระบบเตือนภัยประจำปี",
  },
  {
    name: "ประกันภัยสถานีบริการ",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "high",
    category: "license",
    description: "กรมธรรม์ประกันภัยทรัพย์สินและความรับผิดต่อบุคคลภายนอก",
  },

  // เอกสารถาวร
  {
    name: "ใบจดทะเบียนที่ดิน / โฉนด",
    frequency: "ถาวร",
    regulator: "กรมที่ดิน",
    dangerLevel: "high",
    category: "permanent",
    description: "หลักฐานกรรมสิทธิ์ที่ดินที่ตั้งสถานีบริการ",
  },
  {
    name: "แบบแปลนอาคาร (ที่ได้รับอนุญาต)",
    frequency: "ถาวร",
    regulator: "องค์กรปกครองส่วนท้องถิ่น",
    dangerLevel: "medium",
    category: "permanent",
    description: "แบบแปลนสถานีบริการที่ผ่านการอนุญาตก่อสร้าง",
  },
  {
    name: "สัญญาเช่าที่ดิน",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่าที่ดินกับเจ้าของที่ (ถ้าไม่ใช่ที่ตัวเอง)",
  },

  // แบบฟอร์มมาตรฐาน
  {
    name: "บันทึกการตรวจสภาพปั๊ม",
    frequency: "ทุกวัน",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "medium",
    category: "form",
    description: "บันทึกตรวจอุปกรณ์/ความปลอดภัยรายวันก่อนเปิดให้บริการ",
  },
  {
    name: "บันทึกการรับน้ำมัน",
    frequency: "เมื่อมีเหตุ",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "medium",
    category: "form",
    description: "บันทึกการรับน้ำมันจาก supplier ทุกครั้ง",
  },
  {
    name: "รายงานสต็อกน้ำมัน",
    frequency: "รายเดือน",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "medium",
    category: "form",
    description: "รายงานสต็อกน้ำมันคงเหลือสิ้นเดือน",
  },
];

/* ============================================================
   🔵 lpg_station / lpg_retail — ร้านก๊าซ/ปั๊มแก๊ส
   (DOCUFLOW.md §3 lines 104-123)
   ============================================================ */

const LPG_STATION_DOCS: CanonicalDocSpec[] = [
  // ใบอนุญาต/ต่ออายุ
  {
    name: "ใบอนุญาตค้าก๊าซปิโตรเลียมเหลว",
    frequency: "ทุก 3 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักค้าก๊าซ LPG",
  },
  {
    name: "ใบอนุญาตจัดเก็บก๊าซ (วัตถุอันตราย)",
    frequency: "ทุก 3 ปี",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตเก็บวัตถุอันตรายประเภท 2 (ก๊าซ LPG)",
  },
  {
    name: "ใบรับรองพื้นที่จัดเก็บ",
    frequency: "ทุกปี",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสอบพื้นที่เก็บก๊าซตามมาตรฐานความปลอดภัย",
  },
  {
    name: "ใบรับรองระบบดับเพลิง",
    frequency: "ทุกปี",
    regulator: "กรมป้องกันและบรรเทาสาธารณภัย",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจอุปกรณ์ดับเพลิงประจำปี",
  },
  {
    name: "ประกันภัยร้าน",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "high",
    category: "license",
    description: "กรมธรรม์ประกันภัยทรัพย์สินและความรับผิด",
  },
  {
    name: "ใบรับรองสุขาภิบาล (ถ้ามีจำหน่ายอาหาร)",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "low",
    category: "license",
    description: "ใบรับรองสุขาภิบาล กรณีมีจำหน่ายอาหาร/เครื่องดื่ม",
  },

  // เอกสารถาวร
  {
    name: "สัญญาตัวแทนจำหน่ายก๊าซ",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาตัวแทนจำหน่ายกับ ปตท./WP/Siamgas",
  },
  {
    name: "แบบแปลนร้าน",
    frequency: "ถาวร",
    regulator: "องค์กรปกครองส่วนท้องถิ่น",
    dangerLevel: "medium",
    category: "permanent",
    description: "แบบแปลนพื้นที่ร้าน + จุดเก็บถัง",
  },

  // แบบฟอร์ม
  {
    name: "บันทึกการรับ-จ่ายถัง",
    frequency: "ทุกวัน",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "medium",
    category: "form",
    description: "บันทึกการรับและจำหน่ายถังก๊าซรายวัน",
  },
  {
    name: "รายงานสต็อกถัง",
    frequency: "รายเดือน",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "medium",
    category: "form",
    description: "รายงานจำนวนถังก๊าซคงเหลือสิ้นเดือน",
  },
  {
    name: "บันทึกตรวจสภาพถัง",
    frequency: "ทุกวัน",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "high",
    category: "form",
    description: "ตรวจสภาพถังก่อนจำหน่ายทุกครั้ง — รั่ว/บุบ/หมดอายุ",
  },
];

/* ============================================================
   🏭 bottling_plant — โรงบรรจุก๊าซ (DOCUFLOW.md §3 lines 125-160)
   เอกสารเยอะที่สุด — ธุรกิจอันตรายสูง 17 รายการ
   ============================================================ */

const BOTTLING_PLANT_DOCS: CanonicalDocSpec[] = [
  // ใบอนุญาตหลัก
  {
    name: "ใบอนุญาตประกอบกิจการโรงงาน ประเภท 3",
    frequency: "ทุก 5 ปี",
    regulator: "กระทรวงอุตสาหกรรม",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตโรงงาน ประเภท 3 (รง.4) — เอกสารหลักของโรงงาน",
  },
  {
    name: "ใบอนุญาตมีไว้ครอบครองก๊าซ LPG",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตครอบครองก๊าซ LPG ในปริมาณมาก",
  },
  {
    name: "ใบอนุญาตจัดเก็บวัตถุอันตราย",
    frequency: "ทุก 3 ปี",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตเก็บวัตถุอันตราย (วอ.) ตาม พ.ร.บ.วัตถุอันตราย",
  },
  {
    name: "ใบอนุญาตสิ่งแวดล้อม (EIA)",
    frequency: "5-10 ปี",
    regulator: "สำนักงานนโยบายและแผนทรัพยากรธรรมชาติและสิ่งแวดล้อม",
    dangerLevel: "high",
    category: "license",
    description: "รายงานการวิเคราะห์ผลกระทบสิ่งแวดล้อม (EIA)",
  },
  {
    name: "ใบรับรองระบบบำบัดน้ำเสีย",
    frequency: "ทุก 2 ปี",
    regulator: "กรมควบคุมมลพิษ",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสอบประสิทธิภาพระบบบำบัดน้ำเสียตามเกณฑ์มาตรฐาน",
  },

  // อุปกรณ์/เครื่องจักร
  {
    name: "ใบรับรองถังเก็บก๊าซ (Pressure Vessel)",
    frequency: "ทุก 5 ปี",
    regulator: "วิศวกรเครื่องกลที่ขึ้นทะเบียน",
    dangerLevel: "critical",
    category: "license",
    description: "ตรวจสภาพถังเก็บก๊าซขนาดใหญ่โดยวิศวกรที่ขึ้นทะเบียน",
  },
  {
    name: "ใบรับรองเครื่องชั่ง",
    frequency: "ทุกปี",
    regulator: "สำนักชั่งตวงวัด",
    dangerLevel: "medium",
    category: "license",
    description: "ตรวจสอบความเที่ยงตรงของเครื่องชั่งบรรจุก๊าซ",
  },
  {
    name: "ใบรับรองเครื่องบรรจุก๊าซ",
    frequency: "ทุก 2 ปี",
    regulator: "วิศวกรเครื่องกล",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสภาพเครื่องบรรจุก๊าซโดยวิศวกร",
  },
  {
    name: "ใบรับรองถัง LPG (มอก. 880)",
    frequency: "ทุก 5 ปี",
    regulator: "สำนักงานมาตรฐานผลิตภัณฑ์อุตสาหกรรม",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสภาพถัง LPG รายใบตามมาตรฐาน มอก. 880 (ทุก 5 ปี ต่อถัง)",
  },

  // ความปลอดภัย
  {
    name: "ใบรับรองระบบดับเพลิง",
    frequency: "ทุกปี",
    regulator: "กรมป้องกันและบรรเทาสาธารณภัย",
    dangerLevel: "critical",
    category: "license",
    description: "ตรวจอุปกรณ์ดับเพลิงและระบบ Sprinkler ประจำปี",
  },
  {
    name: "ใบรับรองสายล่อฟ้า",
    frequency: "ทุก 3 ปี",
    regulator: "วิศวกรไฟฟ้า",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจสายล่อฟ้าและระบบ grounding",
  },
  {
    name: "ใบรับรองระบบไฟฟ้า (Hazardous Area)",
    frequency: "ทุก 5 ปี",
    regulator: "วิศวกรไฟฟ้า",
    dangerLevel: "critical",
    category: "license",
    description: "ตรวจระบบไฟฟ้าในพื้นที่อันตราย (Ex-rated equipment)",
  },
  {
    name: "ใบรับรอง Safety Officer",
    frequency: "ทุกปี",
    regulator: "กรมสวัสดิการและคุ้มครองแรงงาน",
    dangerLevel: "high",
    category: "personnel",
    description: "เจ้าหน้าที่ความปลอดภัยในการทำงาน (จป.) ระดับวิชาชีพ",
  },

  // บุคลากร
  {
    name: "ใบรับรองผู้ควบคุมโรงงาน",
    frequency: "ทุก 5 ปี",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "personnel",
    description: "ใบรับรองผู้ควบคุมการผลิตของโรงงาน ประเภท 3",
  },
  {
    name: "ใบรับรองผู้ตรวจสอบถัง LPG",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "high",
    category: "personnel",
    description: "ใบรับรองช่างผู้ตรวจสอบถัง LPG",
  },
  {
    name: "ใบรับรองการฝึกอบรมดับเพลิง (พนักงาน)",
    frequency: "ทุก 3 ปี",
    regulator: "กรมป้องกันและบรรเทาสาธารณภัย",
    dangerLevel: "high",
    category: "personnel",
    description: "พนักงานทุกคนต้องผ่านอบรมดับเพลิงขั้นต้น",
  },

  // แบบฟอร์มบังคับ (กรมโรงงาน)
  {
    name: "บันทึกการผลิตรายวัน",
    frequency: "ทุกวัน",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "high",
    category: "form",
    description: "บันทึกปริมาณก๊าซที่ผลิตและบรรจุรายวัน",
  },
  {
    name: "รายงานสต็อกก๊าซ",
    frequency: "รายเดือน",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "high",
    category: "form",
    description: "รายงานสต็อกก๊าซคงเหลือสิ้นเดือน (Stock report)",
  },
  {
    name: "บันทึกการตรวจสภาพถัง",
    frequency: "ทุกวัน",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "form",
    description: "ตรวจสภาพถังทุกใบก่อนบรรจุและก่อนจำหน่าย",
  },
  {
    name: "รายงานอุบัติเหตุ",
    frequency: "เมื่อมีเหตุ",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "form",
    description: "รายงานอุบัติเหตุภายใน 24 ชม. ตามกฎหมาย",
  },
  {
    name: "แผนฉุกเฉิน (Emergency Response Plan)",
    frequency: "ทุกปี",
    regulator: "กรมโรงงานอุตสาหกรรม",
    dangerLevel: "critical",
    category: "form",
    description: "แผนรับมือเหตุฉุกเฉิน + ซ้อมประจำปี",
  },
];

/* ============================================================
   🏨 hotel — โรงแรม (DOCUFLOW.md §3 lines 184-199)
   ============================================================ */

const HOTEL_DOCS: CanonicalDocSpec[] = [
  {
    name: "ใบอนุญาตประกอบธุรกิจโรงแรม",
    frequency: "ทุก 5 ปี",
    regulator: "กระทรวงมหาดไทย",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักของกิจการโรงแรม",
  },
  {
    name: "ใบรับรองสุขาภิบาล",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "high",
    category: "license",
    description: "สุขาภิบาลห้องพัก/ครัว/ห้องน้ำ",
  },
  {
    name: "ใบรับรองระบบดับเพลิง",
    frequency: "ทุกปี",
    regulator: "กรมป้องกันและบรรเทาสาธารณภัย",
    dangerLevel: "high",
    category: "license",
    description: "ระบบดับเพลิง + Sprinkler + ทางหนีไฟ",
  },
  {
    name: "ใบรับรองลิฟต์",
    frequency: "ทุกปี",
    regulator: "วิศวกรเครื่องกล",
    dangerLevel: "high",
    category: "license",
    description: "ตรวจลิฟต์ประจำปี (ถ้ามี)",
  },
  {
    name: "ใบรับรองระบบไฟฟ้าฉุกเฉิน",
    frequency: "ทุก 3 ปี",
    regulator: "วิศวกรไฟฟ้า",
    dangerLevel: "high",
    category: "license",
    description: "ระบบไฟฟ้าสำรอง + ป้ายทางออก",
  },
  {
    name: "ใบรับรองอาหาร (ครัว/ร้านอาหาร)",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "license",
    description: "ใบรับรองสถานที่ปรุงประกอบอาหาร",
  },
  {
    name: "ประกันภัยโรงแรม",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "high",
    category: "license",
    description: "ประกันทรัพย์สิน + ความรับผิดต่อแขก",
  },
  {
    name: "สัญญาเช่าที่ดิน/อาคาร",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่า (ถ้าไม่ใช่ที่ตัวเอง)",
  },

  // แบบฟอร์ม
  {
    name: "ทะเบียนผู้เข้าพัก",
    frequency: "ทุกวัน",
    regulator: "กระทรวงมหาดไทย",
    dangerLevel: "high",
    category: "form",
    description: "บันทึกผู้เข้าพักตามกฎหมาย (รร.4)",
  },
  {
    name: "รายงานความปลอดภัย",
    frequency: "รายเดือน",
    regulator: "กระทรวงมหาดไทย",
    dangerLevel: "medium",
    category: "form",
    description: "รายงานเหตุการณ์ความปลอดภัยรายเดือน",
  },
];

/* ============================================================
   🏪 convenience_store — 7-Eleven (DOCUFLOW.md §3 lines 201-211)
   ============================================================ */

const CONVENIENCE_STORE_DOCS: CanonicalDocSpec[] = [
  {
    name: "สัญญา Franchise กับ CP All",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "critical",
    category: "permanent",
    description: "สัญญา Franchise (ปกติ 6-10 ปี)",
  },
  {
    name: "ใบอนุญาตประกอบกิจการ",
    frequency: "ทุก 5 ปี",
    regulator: "องค์กรปกครองส่วนท้องถิ่น",
    dangerLevel: "high",
    category: "license",
    description: "ใบอนุญาตประกอบกิจการของท้องถิ่น",
  },
  {
    name: "ใบอนุญาตจำหน่ายอาหาร",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "license",
    description: "ใบอนุญาตจำหน่ายอาหาร/เครื่องดื่ม",
  },
  {
    name: "ใบรับรองสุขาภิบาล",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "license",
    description: "สุขาภิบาลร้านค้า",
  },
  {
    name: "ใบรับรองผู้สัมผัสอาหาร",
    frequency: "ทุก 3 ปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "personnel",
    description: "พนักงานทุกคนที่สัมผัสอาหาร (ต่อคน)",
  },
  {
    name: "ประกันภัยร้าน",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "medium",
    category: "license",
    description: "ประกันภัยทรัพย์สิน + ความรับผิด",
  },
  {
    name: "สัญญาเช่าสถานที่",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่าพื้นที่ร้าน",
  },
];

/* ============================================================
   ☕ cafe / cafe_punthai — Café Amazon / พันธุ์ไทย
   (DOCUFLOW.md §3 lines 213-223 — ใช้ list เดียวกันสำหรับ 2 brand)
   ============================================================ */

const CAFE_DOCS: CanonicalDocSpec[] = [
  {
    name: "สัญญา Franchise",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "critical",
    category: "permanent",
    description: "สัญญา Franchise กับเจ้าของแบรนด์ (Café Amazon / พันธุ์ไทย)",
  },
  {
    name: "ใบอนุญาตประกอบกิจการ",
    frequency: "ทุก 5 ปี",
    regulator: "องค์กรปกครองส่วนท้องถิ่น",
    dangerLevel: "high",
    category: "license",
    description: "ใบอนุญาตประกอบกิจการของท้องถิ่น",
  },
  {
    name: "ใบอนุญาตจำหน่ายอาหาร",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "license",
    description: "ใบอนุญาตจำหน่ายอาหาร/เครื่องดื่ม",
  },
  {
    name: "ใบรับรองสุขาภิบาล",
    frequency: "ทุกปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "license",
    description: "สุขาภิบาลร้านกาแฟ/ครัว",
  },
  {
    name: "ใบรับรองผู้สัมผัสอาหาร",
    frequency: "ทุก 3 ปี",
    regulator: "กรมอนามัย",
    dangerLevel: "medium",
    category: "personnel",
    description: "บาริสต้า/พนักงานทุกคน (ต่อคน)",
  },
  {
    name: "ประกันภัยร้าน",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "medium",
    category: "license",
    description: "ประกันภัยทรัพย์สิน + ความรับผิด",
  },
  {
    name: "สัญญาเช่าสถานที่",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่าพื้นที่ร้าน",
  },
];

/* ============================================================
   ⚡ ev_station — EV Station (DOCUFLOW.md §3 lines 225-234)
   ============================================================ */

const EV_STATION_DOCS: CanonicalDocSpec[] = [
  {
    name: "ใบอนุญาตประกอบกิจการสถานีอัดประจุ",
    frequency: "ทุก 5 ปี",
    regulator: "คณะกรรมการกำกับกิจการพลังงาน (กกพ.)",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักของสถานีอัดประจุไฟฟ้า",
  },
  {
    name: "ใบรับรองระบบไฟฟ้า",
    frequency: "ทุก 3 ปี",
    regulator: "วิศวกรไฟฟ้า",
    dangerLevel: "critical",
    category: "license",
    description: "ตรวจระบบไฟฟ้าแรงสูง/ระบบป้องกันโดยวิศวกร",
  },
  {
    name: "ใบรับรองมาตรฐานหัวชาร์จ (CHAdeMO/CCS)",
    frequency: "ทุก 5 ปี",
    regulator: "สำนักงานมาตรฐานผลิตภัณฑ์อุตสาหกรรม",
    dangerLevel: "high",
    category: "license",
    description: "ใบรับรองหัวชาร์จตามมาตรฐานสากล",
  },
  {
    name: "ใบรับรองมาตรฐาน OCPP",
    frequency: "ทุก 3 ปี",
    regulator: "ผู้ผลิต/ผู้ตรวจสอบมาตรฐาน",
    dangerLevel: "medium",
    category: "license",
    description: "Open Charge Point Protocol — เพื่อเชื่อม backend กลาง",
  },
  {
    name: "ประกันภัย",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "high",
    category: "license",
    description: "ประกันภัยทรัพย์สิน + ความรับผิดต่อบุคคลภายนอก",
  },
  {
    name: "สัญญาเช่าสถานที่",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่าพื้นที่ตั้งสถานี",
  },
];

/* ============================================================
   🎓 training_center — ศูนย์ฝึกอบรม (DOCUFLOW.md §3 lines 236-249)
   ============================================================ */

const TRAINING_CENTER_DOCS: CanonicalDocSpec[] = [
  {
    name: "ใบอนุญาตศูนย์ฝึกอบรม",
    frequency: "ทุก 3 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักของศูนย์ฝึกอบรม",
  },
  {
    name: "ใบรับรองหลักสูตรฝึกอบรม",
    frequency: "ทุก 3 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "high",
    category: "license",
    description:
      "หลักสูตรที่ต้องมีใบรับรอง: ขับขี่รถบรรทุกสินค้าอันตราย · ดับเพลิงขั้นต้น · ความปลอดภัย LPG · ปฐมพยาบาล",
  },
  {
    name: "ใบรับรองครูฝึก/อาจารย์",
    frequency: "ทุก 5 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "high",
    category: "personnel",
    description: "ครูฝึกแต่ละคนต้องขึ้นทะเบียนรับรอง",
  },
  {
    name: "ใบรับรองอุปกรณ์ฝึกอบรม",
    frequency: "ทุก 3 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "medium",
    category: "license",
    description: "อุปกรณ์/รถจำลอง/สื่อฝึกอบรม",
  },
];

/* ============================================================
   💆 massage_chair / 🎮 claw_machine — kiosk (minimal)
   ไม่มีใน spec §3 โดยตรง — เก้าอี้นวด/ตู้คีบเป็น kiosk
   เอกสารหลัก: สัญญาวางตู้ + ประกัน
   ============================================================ */

const KIOSK_DOCS: CanonicalDocSpec[] = [
  {
    name: "สัญญาวางตู้/พื้นที่",
    frequency: "ตามสัญญา",
    regulator: null,
    dangerLevel: "high",
    category: "permanent",
    description: "สัญญาเช่าพื้นที่วางตู้กับเจ้าของสถานที่",
  },
  {
    name: "ใบอนุญาตประกอบกิจการ (ถ้ามี)",
    frequency: "ทุก 5 ปี",
    regulator: "องค์กรปกครองส่วนท้องถิ่น",
    dangerLevel: "medium",
    category: "license",
    description: "ใบอนุญาตประกอบกิจการของท้องถิ่น (กรณีท้องถิ่นกำหนด)",
  },
  {
    name: "ประกันภัยตู้/อุปกรณ์",
    frequency: "ทุกปี",
    regulator: null,
    dangerLevel: "medium",
    category: "license",
    description: "ประกันภัยอุปกรณ์ + ความรับผิดต่อบุคคลภายนอก",
  },
];

/* ============================================================
   🚛 transport / gas_fleet — FuelOS (DOCUFLOW.md §3 lines 162-182)
   เอกสาร 2 ระดับ: บริษัท + รถแต่ละคัน + คนขับ
   หมายเหตุ: รถ/คนขับมี ownership ระดับ vehicle/person แยก
   list นี้คือเอกสารระดับบริษัท (org/company)
   ============================================================ */

const TRANSPORT_COMPANY_DOCS: CanonicalDocSpec[] = [
  {
    name: "ใบอนุญาตประกอบการขนส่งสินค้า",
    frequency: "ทุก 5 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตหลักประกอบการขนส่งสินค้า (บ.7/บ.8)",
  },
  {
    name: "ใบอนุญาตขนส่งวัตถุอันตราย",
    frequency: "ทุก 5 ปี",
    regulator: "กรมการขนส่งทางบก",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตขนส่งวัตถุอันตรายทางบก",
  },
  {
    name: "ใบอนุญาตขนส่งก๊าซ LPG",
    frequency: "ทุก 5 ปี",
    regulator: "กรมธุรกิจพลังงาน",
    dangerLevel: "critical",
    category: "license",
    description: "ใบอนุญาตขนส่งก๊าซปิโตรเลียมเหลว",
  },
];

/* ============================================================
   Registry — biztype → CanonicalDocSpec[]
   ============================================================ */

/** keys รองรับนอกเหนือจาก BusinessTypeKey — สำหรับ FuelOS biztype (transport/gas_fleet) */
export type CanonicalBizType =
  | BusinessTypeKey
  | "transport"
  | "gas_fleet";

const BUSINESS_TYPE_CANONICAL_DOCS: Record<CanonicalBizType, CanonicalDocSpec[]> = {
  fuel_station: FUEL_STATION_DOCS,
  lpg_station: LPG_STATION_DOCS,
  lpg_retail: LPG_STATION_DOCS, // ร้านค้าแก๊สใช้ list เดียวกับปั๊มแก๊ส
  bottling_plant: BOTTLING_PLANT_DOCS,
  hotel: HOTEL_DOCS,
  convenience_store: CONVENIENCE_STORE_DOCS,
  cafe: CAFE_DOCS,
  cafe_punthai: CAFE_DOCS, // พันธุ์ไทยใช้ list เดียวกับ Café Amazon
  ev_station: EV_STATION_DOCS,
  training_center: TRAINING_CENTER_DOCS,
  massage_chair: KIOSK_DOCS,
  claw_machine: KIOSK_DOCS,
  transport: TRANSPORT_COMPANY_DOCS,
  gas_fleet: TRANSPORT_COMPANY_DOCS,
};

/**
 * คืนรายการเอกสารมาตรฐานที่กฎหมายกำหนดให้ business type นี้ต้องมี
 * - ไม่มี orgId — ข้อมูลเป็น industry-wide
 * - คืน [] เมื่อ biztype ไม่อยู่ใน registry
 */
export function getCanonicalDocsForBizType(
  bizType: string,
): CanonicalDocSpec[] {
  return BUSINESS_TYPE_CANONICAL_DOCS[bizType as CanonicalBizType] ?? [];
}

/** รายชื่อ biztype ที่มี canonical list (สำหรับหน้า Checklist) */
export function listSupportedBizTypes(): CanonicalBizType[] {
  return Object.keys(BUSINESS_TYPE_CANONICAL_DOCS) as CanonicalBizType[];
}

/** Map → ปุ่มแสดง category icon */
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  license: "📋 ใบอนุญาต",
  permanent: "📁 ถาวร",
  form: "📝 แบบฟอร์ม",
  personnel: "🧑‍💼 บุคลากร",
};

/** Map → tone สำหรับ badge */
export const DOC_DANGER_TONE: Record<DocDangerLevel, "danger" | "warning" | "neutral" | "success"> = {
  critical: "danger",
  high: "warning",
  medium: "neutral",
  low: "success",
};
