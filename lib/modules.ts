// Pooilgroup ERP — Module registry
// All modules share the SAME blue brand color (per design memory).

import type { LucideIcon } from "lucide-react";
import {
  Wallet,
  Fuel,
  FileText,
  FileText as FileTextIcon,
  LayoutDashboard,
  ScrollText,
  ClipboardList,
  Trophy,
  CalendarDays,
  AlertCircle,
  AlertTriangle,
  Settings,
  ClipboardEdit,
  ClipboardCheck,
  Building2,
  Upload,
  Truck,
  Users as UsersIcon,
  Clock,
  Sparkles,
  CheckSquare,
  GitCompare,
  Zap,
  Boxes,
  GraduationCap,
  FolderTree,
  UserPlus,
  Inbox,
  KanbanSquare,
  ShieldX,
  ListChecks,
  Wrench,
  PackageSearch,
  HardHat,
  Gamepad2,
  Coins,
  PackageOpen,
  Layers,
  Bell,
  BarChart3,
  CalendarRange,
  Workflow,
  History,
  Smile,
  TicketCheck,
  ScanFace,
  Tv,
  ShoppingBasket,
  CalendarClock,
  Home,
  Activity,
  ScanLine,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import type { DbUser } from "./auth/session";

export type ModuleSlug = "cashhub" | "fuelos" | "docuflow" | "recruit" | "repairs" | "clawfleet" | "chairops" | "playland";
export type ModuleStatus = "active" | "coming_soon" | "beta";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** If true, item is visible only to super_admin / org_admin / admin */
  adminOnly?: boolean;
  /**
   * Whitelist of roles allowed to see this nav item. Omit = all signed-in roles.
   * feedback_role_scoped_views.md — ผู้จัดการสาขาเห็นแค่ฟีเจอร์ที่จำเป็น
   */
  roles?: DbUser["role"][];
  /**
   * Optional section label · admin-shell renders a small heading above the first
   * item of each section, then a divider above subsequent sections. When omitted,
   * the item joins the previous section (or renders flat if no module sets section).
   * Modules opt in independently · zero impact on modules that don't set it.
   */
  section?: string;
}

export interface ModuleConfig {
  slug: ModuleSlug;
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  Icon: LucideIcon;
  status: ModuleStatus;
  basePath: string;
  /** Sidebar items shown when this module is active */
  nav: NavItem[];
}

export const MODULES: Record<ModuleSlug, ModuleConfig> = {
  cashhub: {
    slug: "cashhub",
    name: "CashHub",
    tagline: "ยอดสาขารายวัน",
    description:
      "เก็บยอดขายรายวันจากทุกสาขา 11 ประเภทธุรกิจ + อนุมัติผ่าน Telegram + Dashboard เจ้าของ",
    emoji: "💰",
    Icon: Wallet,
    status: "active",
    basePath: "/cashhub",
    nav: [
      // Branch-manager — ผู้จัดการสาขาเห็น 4 รายการเท่านั้น
      // (กรอกยอด · สาขาฉัน · โน้ตจาก Staff · เงินขาด)
      // feedback_role_scoped_views.md
      {
        href: "/cashhub/quick-fill",
        label: "กรอกยอดวันนี้",
        icon: ClipboardCheck,
        roles: ["branch_manager", "staff"],
      },
      {
        href: "/cashhub/my-branches",
        label: "สาขาของฉัน",
        icon: Building2,
        roles: ["branch_manager"],
      },

      // Executive / admin — ภาพรวมระดับองค์กร (ผู้จัดการสาขาห้ามเห็น)
      {
        href: "/cashhub/dashboard",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/cashhub/reports",
        label: "รายงานทั้งหมด",
        icon: ScrollText,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/cashhub/leaderboard",
        label: "Leaderboard",
        icon: Trophy,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/cashhub/heatmap",
        label: "Heatmap",
        icon: CalendarDays,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/cashhub/import",
        label: "ศูนย์นำเข้าข้อมูล",
        icon: Upload,
        adminOnly: true,
      },

      // Shared — เงินขาด/โน้ต ผู้จัดการสาขาเห็นได้ (auto-scoped to own branches)
      { href: "/cashhub/shortages", label: "เงินขาด", icon: AlertCircle },
      { href: "/cashhub/notes", label: "โน้ตจาก Staff", icon: ScrollText },
      {
        href: "/cashhub/missing",
        label: "ขาดส่งรายงาน",
        icon: AlertTriangle,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/cashhub/compare",
        label: "เทียบเดือน",
        icon: GitCompare,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/cashhub/kiosk",
        label: "Kiosk รอบเก็บ",
        icon: Boxes,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/cashhub/training",
        label: "ศูนย์อบรม",
        icon: GraduationCap,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },

      {
        href: "/cashhub/monthly-report",
        label: "รายงานเดือน (PDF)",
        icon: FileTextIcon,
        // Admin tier only — area_manager + viewer ไม่ควรเห็นรายงาน P&L/compliance
        // ระดับองค์กร (กฎ CEO 2026-05-07)
        roles: ["super_admin", "org_admin", "admin"],
      },
      {
        href: "/cashhub/settings/forms",
        label: "ฟอร์มกรอกยอด",
        icon: ClipboardEdit,
        adminOnly: true,
      },
      {
        href: "/cashhub/settings",
        label: "ตั้งค่า CashHub",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  // FuelOS + DocuFlow are placeholders ("เร็วๆนี้") — they exist in the
  // registry so user_modules grants for them resolve and the module switcher
  // can show them. The actual feature pages are stubs until those modules
  // are ready to ship.
  fuelos: {
    slug: "fuelos",
    name: "FuelOS",
    tagline: "ขายส่งน้ำมัน B2B",
    description:
      "Price Engine + CRM 1,400 ลูกค้า + Win/Loss + Driver App + Flash Sale",
    emoji: "⛽",
    Icon: Fuel,
    status: "coming_soon",
    basePath: "/fuelos",
    nav: [{ href: "/fuelos", label: "เร็ว ๆ นี้", icon: ClipboardList }],
  },
  docuflow: {
    slug: "docuflow",
    name: "DocuFlow",
    tagline: "เอกสาร + ลายเซ็น",
    description:
      "1,100+ เอกสาร · ติดตามวันหมดอายุ · ลายเซ็นออนไลน์ · AI วิเคราะห์ก่อนเซ็น",
    emoji: "📄",
    Icon: FileText,
    status: "active",
    basePath: "/docuflow",
    nav: [
      // ─── 4 หลัก: user feedback "ดูง่าย ใช้ง่าย ไม่กี่นาที" (2026-05-12) ───
      {
        href: "/docuflow",
        label: "หน้าหลัก",
        icon: LayoutDashboard,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/browse",
        label: "เอกสารทั้งหมด",
        icon: FolderTree,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/documents/upload",
        label: "อัปโหลด",
        icon: Upload,
        adminOnly: true,
      },
      {
        href: "/docuflow/expiry",
        label: "ใกล้หมดอายุ",
        icon: Clock,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/search",
        label: "ค้นหา AI",
        icon: Sparkles,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      // ─── เฉพาะทาง (ใช้บางครั้ง — อยู่ล่าง ไม่รบกวน 4 หลัก) ───
      {
        href: "/docuflow/documents",
        label: "ค้นหา/กรองขั้นสูง",
        icon: FileTextIcon,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/checklist",
        label: "Checklist เอกสารที่ต้องมี",
        icon: CheckSquare,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/risk",
        label: "ความเสี่ยงรวม",
        icon: AlertTriangle,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/calendar",
        label: "ปฏิทินวันหมดอายุ",
        icon: CalendarRange,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/notifications",
        label: "การแจ้งเตือน",
        icon: Bell,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/reports",
        label: "รายงาน & สถิติ",
        icon: BarChart3,
        adminOnly: true,
      },
      {
        href: "/docuflow/workflow",
        label: "Workflow ลายเซ็น",
        icon: Workflow,
        adminOnly: true,
      },
      {
        href: "/docuflow/audit",
        label: "Audit Log",
        icon: History,
        adminOnly: true,
      },
      {
        href: "/docuflow/vehicles",
        label: "รถ + เอกสาร",
        icon: Truck,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/persons",
        label: "พนักงาน + เอกสาร",
        icon: UsersIcon,
        adminOnly: true,
      },
      {
        href: "/docuflow/settings",
        label: "ตั้งค่า DocuFlow",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  repairs: {
    slug: "repairs",
    name: "ระบบแจ้งซ่อม",
    tagline: "ใครก็แจ้งได้ · ช่างเห็นงานตัวเอง · จัดซื้อเห็นอะไหล่",
    description:
      "เปิดใบแจ้งซ่อมจากลิ้งค์เดียว · ติดตามสถานะ · มอบหมายช่าง · จัดซื้อรวมอะไหล่ข้ามใบ · timeline + รูปก่อน/หลัง",
    emoji: "🛠",
    Icon: Wrench,
    status: "active",
    basePath: "/repairs",
    nav: [
      {
        href: "/repairs",
        label: "ภาพรวม Command",
        icon: LayoutDashboard,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/repairs/triage",
        label: "Triage Inbox",
        icon: Inbox,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/repairs/kanban",
        label: "Kanban",
        icon: KanbanSquare,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/repairs/table",
        label: "ใบทั้งหมด · ตาราง",
        icon: Layers,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/repairs/my-jobs",
        label: "งานของฉัน",
        icon: HardHat,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/repairs/parts",
        label: "อะไหล่ที่ต้องสั่ง",
        icon: PackageSearch,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/repairs/recurring",
        label: "ของพังซ้ำ",
        icon: AlertTriangle,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/repairs/technicians",
        label: "ช่าง",
        icon: UsersIcon,
        adminOnly: true,
      },
      {
        href: "/repairs/categories",
        label: "หมวดงาน",
        icon: ListChecks,
        adminOnly: true,
      },
      {
        href: "/repairs/settings",
        label: "ตั้งค่า",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  clawfleet: {
    slug: "clawfleet",
    name: "ClawFleet",
    tagline: "ตู้คีบ + ตู้แลกเหรียญ · cross-check",
    description:
      "เก็บเงินตู้คีบทุกสาขา · cross-check ตู้แลกเหรียญ ห้าม 'แลกนอกตู้' · ระบบกันโง่ 32 ข้อ · stock + รีพอตรายวัน",
    emoji: "🎮",
    Icon: Gamepad2,
    status: "active",
    basePath: "/clawfleet",
    nav: [
      {
        href: "/clawfleet/hub",
        label: "หน้าแรก",
        icon: Home,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff", "viewer"],
      },
      {
        href: "/clawfleet/v2/hub",
        label: "ดีไซน์ใหม่ (พรีวิว)",
        icon: Sparkles,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff", "viewer"],
      },
      {
        href: "/clawfleet/operations",
        label: "ปฏิบัติการ",
        icon: Activity,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/clawfleet/insights",
        label: "ข้อมูล",
        icon: BarChart3,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/clawfleet/setup",
        label: "ตั้งค่า",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  chairops: {
    slug: "chairops",
    name: "เก้าอี้นวด",
    tagline: "บริหาร 30 สาขา · ตรวจเงิน · แม่บ้าน · ของเสีย",
    description:
      "ระบบจัดการเก้าอี้นวด 30 สาขา · บันทึกรอบเก็บเงินจากแม่บ้าน · cross-check กับ POS · ของเสีย/อะไหล่ · ความสะอาด",
    emoji: "💆",
    Icon: Sparkles,
    status: "active",
    basePath: "/chairops",
    nav: [
      // ── ภาพรวม ──────────────────────────────────────────────
      {
        href: "/chairops/dashboard",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        section: "ภาพรวม",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/chairops/branches",
        label: "สาขา",
        icon: Building2,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      // ── ปฏิบัติงาน ──────────────────────────────────────────
      {
        href: "/chairops/pos-ingest",
        label: "อัปโหลด POS",
        icon: Upload,
        section: "ปฏิบัติงาน",
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/chairops/reconcile",
        label: "ตรวจยอด (Reconcile)",
        icon: GitCompare,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/chairops/collections",
        label: "ประวัติเก็บเงิน",
        icon: ClipboardCheck,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/chairops/alerts",
        label: "แจ้งเตือน",
        icon: AlertCircle,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/chairops/cleanliness",
        label: "ความสะอาด",
        icon: CheckSquare,
      },
      {
        href: "/chairops/damage",
        label: "ของเสีย",
        icon: Wrench,
      },
      {
        href: "/chairops/parts",
        label: "อะไหล่",
        icon: PackageSearch,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      // ── การเงิน ─────────────────────────────────────────────
      {
        href: "/chairops/write-offs",
        label: "ตัดเงินขาด",
        icon: ShieldX,
        section: "การเงิน",
        roles: ["super_admin", "org_admin", "admin"],
      },
      {
        href: "/chairops/accounts",
        label: "บัญชีธนาคาร",
        icon: Coins,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      {
        href: "/chairops/reports",
        label: "รายงาน",
        icon: ScrollText,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      // ── จัดการ ──────────────────────────────────────────────
      {
        href: "/chairops/users",
        label: "ผู้ใช้ ChairOps",
        icon: UsersIcon,
        section: "จัดการ",
        adminOnly: true,
      },
      {
        href: "/chairops/audit",
        label: "Audit ChairOps",
        icon: ScrollText,
        adminOnly: true,
      },
    ],
  },
  recruit: {
    slug: "recruit",
    name: "รับสมัครพนักงาน",
    tagline: "Form builder + Pipeline + AI",
    description:
      "สร้างลิ้งค์รับสมัครงาน · เก็บใบสมัครถาวร · AI ช่วยคัดกรอง · Blacklist · ใช้รวม Pooil + JPSync",
    emoji: "📥",
    Icon: UserPlus,
    status: "active",
    basePath: "/recruit",
    nav: [
      {
        href: "/recruit",
        label: "ใบสมัคร",
        icon: Inbox,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        href: "/recruit/postings",
        label: "ประกาศ",
        icon: ClipboardList,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/recruit/pipeline",
        label: "Pipeline",
        icon: KanbanSquare,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/recruit/tasks",
        label: "งานต้องตาม",
        icon: ListChecks,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/recruit/blacklist",
        label: "Blacklist",
        icon: ShieldX,
        adminOnly: true,
      },
      {
        href: "/recruit/settings",
        label: "ตั้งค่า",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  playland: {
    slug: "playland",
    name: "Playland",
    tagline: "ระบบบริหารสวนสนุก · Face Gate",
    description:
      "ลงทะเบียนสมาชิก + face recognition + คิดเวลาเล่นอัตโนมัติ + POS ขนม + จองล่วงหน้า + รายงานรายวัน · ACS-F606 + ACS302",
    emoji: "🎡",
    Icon: Smile,
    status: "active",
    basePath: "/playland",
    nav: [
      // Sections render as visual group headers in the sidebar (admin-shell.tsx)
      { href: "/playland",         label: "Cockpit",        icon: Activity, section: "Cockpit" },
      { href: "/playland/monitor", label: "Monitor (TV)",   icon: Tv },
      { href: "/playland/scan",    label: "สแกน wristband", icon: ScanLine },

      { href: "/playland/members",     label: "สมาชิก",       icon: ScanFace,       section: "ลูกค้า" },
      { href: "/playland/wristbands",  label: "สายรัดข้อมือ",  icon: QrCode },
      { href: "/playland/bookings",    label: "จองล่วงหน้า",  icon: CalendarClock },

      { href: "/playland/pos",     label: "POS · ขายของ",   icon: ShoppingBasket, section: "หน้าร้าน" },
      {
        href: "/playland/shifts",
        label: "กะ · ปิดวัน",
        icon: TicketCheck,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/playland/settings/stock-count",
        label: "นับสต๊อก",
        icon: ClipboardList,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },

      {
        href: "/playland/overrides",
        label: "เปิดประตูเอง",
        icon: ShieldAlert,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
        section: "Back-office",
      },
      {
        href: "/playland/reports",
        label: "รายงาน",
        icon: BarChart3,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      { href: "/playland/audit",   label: "Audit Log",   icon: History,  adminOnly: true },
      { href: "/playland/settings",label: "ตั้งค่า",     icon: Settings, adminOnly: true },
    ],
  },
};

export const MODULE_LIST = Object.values(MODULES);

/** Returns the module slug from a given pathname (or null for non-module routes). */
export function getModuleFromPath(pathname: string): ModuleSlug | null {
  for (const m of MODULE_LIST) {
    if (pathname === m.basePath || pathname.startsWith(m.basePath + "/")) {
      return m.slug;
    }
  }
  return null;
}

// =============================================================
// Per-module kill switch (รอบ 46 ultraview audit · 2026-05-21)
// Set env `MODULES_DISABLED=fuelos,docuflow` to hide modules from
// the nav switcher AND block direct URL access via assertModuleEnabled.
// Env is read at module load — process must restart for changes to apply.
// =============================================================
const DISABLED_SLUGS = new Set<string>(
  (process.env.MODULES_DISABLED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function isModuleDisabled(slug: ModuleSlug): boolean {
  return DISABLED_SLUGS.has(slug);
}

export function getEnabledModules(): ModuleConfig[] {
  return MODULE_LIST.filter((m) => !DISABLED_SLUGS.has(m.slug));
}
