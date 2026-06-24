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
  { key: "transfer", href: "/dc/transfer", label: "ส่ง / โอน", hint: "ส่งไปสาขา/คลังอื่น", icon: "Truck", tone: "green" },
  { key: "move", href: "/dc/move", label: "ย้ายที่", hint: "ย้ายของระหว่างชั้นวาง", icon: "ArrowLeftRight", tone: "slate" },
  { key: "count", href: "/dc/count", label: "นับสต๊อก", hint: "นับรอบ · ทำงานตอนเน็ตหลุดได้", icon: "ClipboardCheck", tone: "amber" },
  { key: "issue", href: "/dc/issue", label: "เบิกออก", hint: "เบิกของ/อะไหล่ออกจากคลัง", icon: "PackageMinus", tone: "red" },
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
  PARTIAL: "รับบางส่วน",
  CLOSED: "ปิดใบ",
  CANCELLED: "ยกเลิก",
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
