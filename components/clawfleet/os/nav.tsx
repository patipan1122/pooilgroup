/**
 * ClawOS — sidebar nav config (shared). ลำดับ + label + href + icon ตรงกับ design.
 * badge keys map ไปยัง count ที่ shell ส่งเข้ามา (จาก loadNavCounts ฝั่ง server).
 */
import {
  LayoutDashboard,
  Store,
  PackageOpen,
  ScrollText,
  SlidersHorizontal,
  Grid3x3,
  BarChart3,
  Users,
  Settings,
  Smartphone,
  Wrench,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavBadgeKey = "lowStock" | "diffs" | "pendingConfig" | "anomalies";

export interface ClawNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: NavBadgeKey;
  /** role ที่เห็นเมนูนี้ (นอกเหนือ admin-tier ที่เห็นทุกอัน). undefined = admin-tier เท่านั้น */
  roles?: readonly string[];
}

/** admin-tier (เห็นทุกเมนู) */
export const CLAW_ADMIN_TIER = ["super_admin", "org_admin", "admin", "program_admin"] as const;

export const OS_BASE = "/clawfleet/os";

/** หลังบ้าน (back-office) — desktop */
const MGR = ["area_manager", "branch_manager"] as const;
export const BACK_NAV: ClawNavItem[] = [
  { key: "dashboard", label: "ภาพรวม", href: `${OS_BASE}/dashboard`, icon: LayoutDashboard, roles: [...MGR, "viewer"] },
  { key: "branches", label: "สาขา", href: `${OS_BASE}/branches`, icon: Store, roles: [...MGR] },
  { key: "stock", label: "คลังสินค้า", href: `${OS_BASE}/stock`, icon: PackageOpen, badge: "lowStock", roles: [...MGR] },
  { key: "collections", label: "ตรวจเงิน & กระทบยอด", href: `${OS_BASE}/collections`, icon: ScrollText, badge: "diffs", roles: [...MGR] },
  // ฝากเงิน — ผู้เก็บ (staff) ต้องบันทึกฝากได้ด้วย → รวม staff นอกเหนือ ผจก.+แอดมิน
  { key: "deposits", label: "ฝากเงิน", href: `${OS_BASE}/deposits`, icon: Wallet, roles: [...MGR, "staff"] },
  { key: "config", label: "ตั้งค่าตู้", href: `${OS_BASE}/config`, icon: SlidersHorizontal, badge: "pendingConfig", roles: [...MGR] },
  { key: "repairs", label: "แจ้งซ่อม", href: `${OS_BASE}/repairs`, icon: Wrench, roles: [...MGR] },
  { key: "matrix", label: "รายงานเจาะสาขา", href: `${OS_BASE}/matrix`, icon: Grid3x3, roles: [...MGR, "viewer"] },
  { key: "reports", label: "รายงาน", href: `${OS_BASE}/reports`, icon: BarChart3, roles: [...MGR, "viewer"] },
  { key: "staff", label: "พนักงาน", href: `${OS_BASE}/staff`, icon: Users, roles: ["area_manager"] },
  { key: "settings", label: "ตั้งค่า & สิทธิ์", href: `${OS_BASE}/settings`, icon: Settings },
];

/** หน้าบ้าน (front-of-house) — mobile employee app */
export const FRONT_NAV: ClawNavItem = {
  key: "app",
  label: "แอปพนักงาน (มือถือ)",
  href: `${OS_BASE}/app`,
  icon: Smartphone,
};

export type NavCounts = Partial<Record<NavBadgeKey, number>>;

/** หัวข้อหน้า (title + sub) ต่อ screen — โชว์ใน header ของ shell */
export const SCREEN_META: Record<string, { title: string; sub: string }> = {
  dashboard: { title: "ภาพรวมร้าน", sub: "สรุปกำไร–ขาดทุน · ตู้เสี่ยง · สุขภาพการตั้งค่าตู้ทุกสาขา" },
  branches: { title: "สาขา", sub: "ดูทุกสาขา · ตู้ในแต่ละสาขา · กดเจาะดูรายตู้" },
  stock: { title: "คลังสินค้า", sub: "คลังกลาง + สต็อกสาขา · การโอน · หมุนเวียน FIFO" },
  collections: { title: "ตรวจเงิน & กระทบยอด", sub: "รอบเก็บเงินทุกตู้ · เทียบมิเตอร์กับเงินสด · ธงไม่ตรง" },
  config: { title: "ตั้งค่าตู้", sub: "คำขอปรับความแรงการคีบ/ราคา · รออนุมัติจากเจ้าของ" },
  deposits: { title: "ฝากเงิน", sub: "เงินที่เก็บได้ ฝากเข้าธนาคารครบไหม · รอบค้างมือ · เทียบฝากจริงกับควรฝาก" },
  repairs: { title: "แจ้งซ่อม / ตู้เสีย", sub: "พนักงานแจ้งตู้เสียหน้างาน · ตามซ่อม · ปิดงาน · ตั้งมิเตอร์ใหม่หลังซ่อม" },
  matrix: { title: "รายงานเจาะสาขา", sub: "ทุกตู้ × รายวันย้อนหลัง ในตารางเดียว" },
  reports: { title: "รายงาน", sub: "ตู้มีปัญหา · สินค้าใกล้หมด · คุณภาพงานพนักงาน" },
  staff: { title: "พนักงาน", sub: "ทีมเก็บเงิน · เส้นทางดูแล · คุณภาพงาน" },
  settings: { title: "ตั้งค่า & สิทธิ์", sub: "บทบาท · สิทธิ์เข้าถึงเมนู · นโยบายระบบ · บัญชีผู้ใช้" },
  app: { title: "แอปพนักงาน (หน้าบ้าน)", sub: "พรีวิวสิ่งที่พนักงานเห็นบนมือถือ — กดลองได้จริง" },
};

/** แปลง pathname → { key, title, sub } */
export function routeMeta(pathname: string): { key: string; title: string; sub: string } {
  const all = [...BACK_NAV, FRONT_NAV];
  const match = all.find((it) => pathname === it.href || pathname.startsWith(it.href + "/"));
  const key = match?.key ?? "dashboard";
  const meta = SCREEN_META[key] ?? SCREEN_META.dashboard;
  return { key, ...meta };
}
