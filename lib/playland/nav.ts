// Playland · แผนผังโหมด "หน้าร้าน" (front-of-house) vs "หลังร้าน" (back-office)
//
// ⚠️ PURE CONSTANTS — ห้าม import prisma/server-only ที่นี่ (client component import ได้)
//    per [[nextjs-client-import-prisma-constants-boundary]]
//
// หน้าร้าน = งานเคาน์เตอร์เร็ว ๆ (cockpit · ระหว่างเล่น · เช็คเอาท์ · POS · สแกน · ค้นสมาชิก · จอ TV)
// หลังร้าน = งานจัดการ (รายงาน · กะ/ปิดวัน · จอง · สายรัด/อุปกรณ์ · เปิดประตูเอง · audit · ตั้งค่า)

export type PlMode = "front" | "office";

// path ที่ถือว่าเป็น "หลังร้าน" — ที่เหลือใต้ /playland = หน้าร้าน
const OFFICE_PREFIXES = [
  "/playland/office",
  "/playland/reports",
  "/playland/shifts",
  "/playland/audit",
  "/playland/overrides",
  "/playland/bookings",
  "/playland/wristbands",
  "/playland/settings",
] as const;

export const FRONT_HOME = "/playland";
export const OFFICE_HOME = "/playland/office";

/** ดูจาก pathname ว่าตอนนี้อยู่โหมดไหน */
export function playlandMode(pathname: string): PlMode {
  return OFFICE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ? "office"
    : "front";
}
