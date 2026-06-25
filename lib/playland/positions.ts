// Playland · ตำแหน่งพนักงาน + ตารางสิทธิ์ (single source of truth · pure · import ได้ทั้ง client/server)
// "ตำแหน่งเฉพาะ Playland" — ไม่ยุ่ง role ระบบ/โปรแกรมอื่น (CEO 2026-06-25)

export const PLAYLAND_POSITIONS = [
  { key: "owner", label: "เจ้าของร้าน", gloss: "ทำได้ทุกอย่าง" },
  { key: "manager", label: "ผู้จัดการ", gloss: "ดูแลรายวัน · ดูเงิน · ลบได้ · ไม่ตั้งค่าระบบ" },
  { key: "cashier", label: "แคชเชียร์", gloss: "หน้าร้าน · รับเด็ก/ขาย/บันทึกดูแล" },
] as const;
export type PlaylandPositionKey = (typeof PLAYLAND_POSITIONS)[number]["key"];

// สิทธิ์ที่โชว์ในตาราง (derived จากตำแหน่ง · ไม่ติ๊กทีละช่อง)
export const PLAYLAND_PERMISSIONS = [
  { key: "shift", label: "เปิด/ปิดกะ · นับเงิน" },
  { key: "refund", label: "คืนเงิน/ส่วนลด/ยกเลิกบิล" },
  { key: "reports", label: "ดูรายงาน · กำไร-ขาดทุน" },
  { key: "settings", label: "ตั้งค่าระบบ · ราคา · ตำแหน่ง" },
  { key: "care", label: "บันทึกงานดูแลร้าน" },
  { key: "delete", label: "ลบข้อมูล" },
] as const;
export type PlaylandPermissionKey = (typeof PLAYLAND_PERMISSIONS)[number]["key"];

// matrix: ตำแหน่ง → ทำสิทธิ์ไหนได้บ้าง
export const POSITION_PERMISSIONS: Record<PlaylandPositionKey, Record<PlaylandPermissionKey, boolean>> = {
  owner: { shift: true, refund: true, reports: true, settings: true, care: true, delete: true },
  manager: { shift: true, refund: true, reports: true, settings: false, care: true, delete: true },
  cashier: { shift: true, refund: false, reports: false, settings: false, care: true, delete: false },
};

export const isPlaylandPosition = (k: string | null | undefined): k is PlaylandPositionKey =>
  k === "owner" || k === "manager" || k === "cashier";

export const positionLabel = (k: string | null | undefined): string =>
  PLAYLAND_POSITIONS.find((p) => p.key === k)?.label ?? "ยังไม่กำหนด";
