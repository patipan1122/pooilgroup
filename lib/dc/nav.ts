// DC Warehouse · แผนผังโหมด "หน้าคลัง" (floor) vs "หลังบ้าน" (back-office)
//
// ⚠️ PURE CONSTANTS — ห้าม import prisma/server-only ที่นี่ (client component import ได้)
//    per [[nextjs-client-import-prisma-constants-boundary]]
//
// หน้าคลัง = งานพนักงานหน้างาน บน iPad/มือถือ ปุ่มใหญ่ สแกนเป็นหลัก
// หลังบ้าน = งานคุมระบบ (สั่งจีน · ต้นทุน · ทะเบียน · สิทธิ์ · รายงาน) บนเดสก์ท็อป

export type DcMode = "floor" | "office";

const OFFICE_PREFIXES = ["/dc/office"] as const;

export const FLOOR_HOME = "/dc";
export const OFFICE_HOME = "/dc/office";

/** ดูจาก pathname ว่าตอนนี้อยู่โหมดไหน */
export function dcMode(pathname: string): DcMode {
  return OFFICE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ? "office"
    : "floor";
}

// ---- งานหน้าคลัง 7 อย่าง (big-tile launcher) ----
export type FloorTask = {
  key: string;
  href: string;
  label: string;
  hint: string;
  icon: string; // lucide name (resolved in the tile component)
  tone: "blue" | "green" | "amber" | "red" | "slate";
};

export const FLOOR_TASKS: FloorTask[] = [
  { key: "receive", href: "/dc/receive", label: "รับเข้า", hint: "ของมาถึง · สแกน · นับ · ยืนยัน", icon: "PackagePlus", tone: "blue" },
  { key: "receive-po", href: "/dc/receive-po", label: "รับตาม PO", hint: "รับของที่สั่งจากจีน/ไทย เข้าคลัง", icon: "PackagePlus", tone: "blue" },
  { key: "transfer", href: "/dc/transfer?tab=transfer", label: "โอน · ย้ายที่", hint: "ส่งไปสาขา/คลังอื่น หรือย้ายที่เก็บในคลัง", icon: "Truck", tone: "green" },
  { key: "transfers", href: "/dc/transfers", label: "ใบที่ฉันส่ง / รอรับ", hint: "ดูของที่ส่งออก + ของรอรับเข้าคลังนี้", icon: "Truck", tone: "green" },
  { key: "count", href: "/dc/count", label: "นับสต๊อก", hint: "นับรอบ · ทำงานตอนเน็ตหลุดได้", icon: "ClipboardCheck", tone: "amber" },
  { key: "issue", href: "/dc/transfer?tab=issue", label: "เบิกออก", hint: "เบิกของ/อะไหล่ออกจากคลัง", icon: "PackageMinus", tone: "red" },
  { key: "products", href: "/dc/products", label: "ดูสินค้า", hint: "ไล่ดูสินค้าทั้งหมด + รูป + คงเหลือ", icon: "Boxes", tone: "slate" },
  { key: "search", href: "/dc/search", label: "ค้นหา", hint: "ของชิ้นนี้อยู่ไหน เหลือเท่าไหร่", icon: "Search", tone: "slate" },
  { key: "labels", href: "/dc/labels", label: "ปริ้นฉลาก", hint: "พิมพ์ QR แปะสินค้า", icon: "QrCode", tone: "blue" },
];

// ---- label maps (ใช้ทั้ง client + server) ----
export const MOVE_KIND_LABEL: Record<string, string> = {
  RECEIVE: "รับเข้า",
  ISSUE: "เบิกออก",
  TRANSFER_OUT: "โอนออก",
  TRANSFER_IN: "รับโอน",
  COUNT_ADJUST: "ปรับจากนับ",
  MOVE: "ย้ายที่",
  RETURN_IN: "รับคืน",
};

export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "ร่าง",
  PENDING_APPROVAL: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  ORDERED: "สั่งแล้ว",
  SHIPPED: "ได้เลข Tracking",
  ARRIVED_TH: "ถึงไทยแล้ว",
  AT_WAREHOUSE: "ถึงโกดังแล้ว",
  READY_TO_RECEIVE: "ถึงโกดังแล้ว",
  RECEIVED: "รับสินค้าแล้ว",
  PARTIAL: "รับบางส่วน",
  CLOSED: "ปิดใบ",
  CANCELLED: "ยกเลิก",
};

// ลำดับสถานะที่ใช้แสดงแท็บ/Kanban (เรียงตาม flow จริง)
export const PO_FLOW_STATUSES: string[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ORDERED",
  "SHIPPED",
  "ARRIVED_TH",
  "AT_WAREHOUSE",
  "RECEIVED",
];

// คอลัมน์หลักของบอร์ดสถานะ (Kanban) ตาม mockup — ตัด DRAFT/PENDING/APPROVED ออก
// (PARTIAL/CLOSED/CANCELLED แสดงในโซน "อื่น ๆ" ต่างหาก)
// รวมด่าน "ถึงโกดังแล้ว" เป็นคอลัมน์เดียว (AT_WAREHOUSE) — READY_TO_RECEIVE (legacy) ถูก normalize เข้ามาที่คอลัมน์นี้
export const PO_FLOW_CORE: string[] = ["ORDERED", "SHIPPED", "ARRIVED_TH", "AT_WAREHOUSE", "RECEIVED"];

// ป้ายคอลัมน์ Kanban (สั้น ตรงตาม mockup) — แยกจาก PO_STATUS_LABEL ที่ใช้กับป้ายในหน้ารายละเอียด
export const PO_KANBAN_LABEL: Record<string, string> = {
  ORDERED: "สั่งแล้ว",
  SHIPPED: "ได้เลข Tracking",
  ARRIVED_TH: "ถึงไทยแล้ว",
  AT_WAREHOUSE: "ถึงโกดังแล้ว",
  READY_TO_RECEIVE: "ถึงโกดังแล้ว",
  RECEIVED: "รับแล้ว",
};

// action หลัก 1 อันต่อคอลัมน์ (ลิงก์ไปหน้ารายละเอียดของใบนั้น)
export const PO_KANBAN_ACTION: Record<string, string> = {
  ORDERED: "ใส่เลข Tracking",
  SHIPPED: "อัปเดตขนส่ง",
  ARRIVED_TH: "ติดตามขนส่ง",
  AT_WAREHOUSE: "รับเข้า GRN",
  RECEIVED: "เปิดดูใบ",
};

// สีป้ายสถานะ (ใช้ class dc-st--*)
export const PO_STATUS_TONE: Record<string, string> = {
  DRAFT: "draft",
  PENDING_APPROVAL: "wait",
  APPROVED: "ok",
  ORDERED: "ok",
  SHIPPED: "ship",
  ARRIVED_TH: "arrive",
  AT_WAREHOUSE: "arrive",
  READY_TO_RECEIVE: "arrive",
  RECEIVED: "done",
  PARTIAL: "ship",
  CLOSED: "done",
  CANCELLED: "cancel",
};

export const PO_ORIGIN_LABEL: Record<string, string> = {
  CHINA: "จีน",
  THAI: "ไทย",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  PREPARING: "เตรียมส่ง",
  IN_TRANSIT: "กำลังขนส่ง",
  ARRIVED: "ถึงไทยแล้ว",
  RECEIVED: "รับเข้าคลังแล้ว",
};

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  DISPATCHED: "ส่งออกแล้ว",
  IN_TRANSIT: "กำลังส่ง",
  CONFIRMED: "ปลายทางรับแล้ว",
  AUTO_UNVERIFIED: "รับอัตโนมัติ (ยังไม่ยืนยัน)",
  CANCELLED: "ยกเลิก",
};

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  SALE: "สินค้าขาย",
  SPARE: "อะไหล่",
};
