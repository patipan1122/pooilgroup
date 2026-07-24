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
  Store,
  SlidersHorizontal,
  Grid3x3,
  Smartphone,
  Coins,
  PackageOpen,
  Layers,
  Bell,
  BarChart3,
  BookOpen,
  ReceiptText,
  HandCoins,
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
  MessagesSquare,
  Bot,
  Banknote,
  Gauge,
  BedDouble,
  ImageIcon,
  CalendarCheck,
  Receipt,
  Wallet2,
  Landmark,
  Gift,
  Warehouse,
  PackagePlus,
  PackageMinus,
  ArrowLeftRight,
  Ship,
  Search,
  ShoppingCart,
} from "lucide-react";
import type { DbUser } from "./auth/session";

export type ModuleSlug = "cashhub" | "fuelos" | "docuflow" | "recruit" | "repairs" | "clawfleet" | "chairops" | "playland" | "inbox" | "costctrl" | "hotelbook" | "ledger" | "rentspace" | "clawhub" | "dc";
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
  /**
   * Extra pathname prefixes that should ALSO light this item up — for a menu item
   * that fronts several sibling routes merged into tabs (e.g. "เอกสารคลัง" fronting
   * receipts/transfers/moves/issues). Compared with the same exact-or-descendant rule as href.
   */
  activePrefixes?: string[];
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
      {
        href: "/cashhub/shortages",
        label: "เงินขาด",
        icon: AlertCircle,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        href: "/cashhub/notes",
        label: "โน้ตจาก Staff",
        icon: ScrollText,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
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
    status: "active",
    basePath: "/fuelos",
    nav: [
      { href: "/fuelos/dashboard", label: "หน้าหลัก", icon: Home },
      { href: "/fuelos/inbox", label: "กล่องแชท", icon: ClipboardList },
      { href: "/fuelos/customers", label: "ลูกค้า", icon: UsersIcon },
      { href: "/fuelos/quotes", label: "ใบเสนอราคา", icon: FileText },
      { href: "/fuelos/orders", label: "ออเดอร์", icon: Receipt },
      { href: "/fuelos/sales", label: "ยอดขาย/ลูกหนี้", icon: Coins },
      { href: "/fuelos/pricing", label: "ราคาน้ำมัน", icon: Fuel },
      { href: "/fuelos/pump-price", label: "ราคาหน้าปั๊ม", icon: Fuel },
      { href: "/fuelos/dispatch", label: "จัดส่ง + GPS", icon: Truck },
      { href: "/fuelos/gps", label: "รายงานรถ GPS", icon: Gauge },
      { href: "/fuelos/finance", label: "การเงิน", icon: Wallet },
      { href: "/fuelos/reports", label: "รายงาน", icon: Gauge },
      { href: "/fuelos/settings", label: "ตั้งค่า", icon: Settings },
    ],
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
    name: "ตู้คีบ OS",
    tagline: "บริหารร้านตู้คีบทุกสาขา · กันโกง · P&L",
    description:
      "เก็บเงินตู้คีบทุกสาขา · กระทบยอดมิเตอร์↔เงินสด↔ตุ๊กตา กันโกง · กำไร–ขาดทุนรายตู้ · คลัง + รายงานรายวัน",
    emoji: "🎮",
    Icon: Gamepad2,
    status: "active",
    basePath: "/clawfleet",
    nav: [
      { href: "/clawfleet/os/dashboard", label: "ภาพรวม", icon: Home, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"] },
      { href: "/clawfleet/os/branches", label: "สาขา", icon: Store, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      // management hub — สร้าง/แก้/ลบ สาขา+ตู้ · ดูประวัติตู้ · คลังประจำสาขา (แอดมินเท่านั้น)
      { href: "/clawfleet/os/manage", label: "จัดการ", icon: Layers, section: "หลังบ้าน", adminOnly: true },
      // นำเข้าเก็บเงิน/เติมตุ๊กตาจาก Excel ทีเดียวหลายตู้หลายวัน (พรีวิวก่อนบันทึก · แอดมินเท่านั้น)
      { href: "/clawfleet/os/import", label: "นำเข้า Excel", icon: Upload, section: "หลังบ้าน", adminOnly: true },
      { href: "/clawfleet/os/stock", label: "คลังสินค้า", icon: PackageOpen, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/clawfleet/os/collections", label: "ตรวจเงิน & กระทบยอด", icon: Activity, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/clawfleet/os/config", label: "ตั้งค่าตู้", icon: SlidersHorizontal, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/clawfleet/os/matrix", label: "รายงานเจาะสาขา", icon: Grid3x3, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"] },
      { href: "/clawfleet/os/711", label: "รายงานตู้ 7-11", icon: ShoppingBasket, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"] },
      { href: "/clawfleet/os/reports", label: "รายงาน", icon: BarChart3, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "viewer"] },
      { href: "/clawfleet/os/staff", label: "พนักงาน", icon: UsersIcon, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager"] },
      { href: "/clawfleet/os/settings", label: "ตั้งค่า & สิทธิ์", icon: Settings, section: "หลังบ้าน", adminOnly: true },
      { href: "/clawfleet/os/app", label: "แอปพนักงาน (มือถือ)", icon: Smartphone, section: "หน้าบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"] },
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
      // ── นำเข้า ──────────────────────────────────────────────
      // F1 audit MISS-04 · CSV upload of maid rounds (CEO+ADMIN only)
      {
        href: "/chairops/import/maid-collections",
        label: "นำเข้ายอดแม่บ้าน (CSV)",
        icon: Upload,
        section: "นำเข้า",
        roles: ["super_admin", "org_admin", "admin"],
      },
      // CEO 2026-06-30 · see every CSV import in one place + delete/restore
      {
        href: "/chairops/import/history",
        label: "ประวัติการนำเข้า CSV",
        icon: History,
        section: "นำเข้า",
        roles: ["super_admin", "org_admin", "admin"],
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
      // IA-01 (audit 2026-06-15): desktop sidebar was missing 3 pages the mobile
      // bottom-nav already had → these routes were unreachable on desktop. Add them
      // so the maker-checker review queue + collect/deposit flow are findable.
      {
        href: "/chairops/branch-collect",
        label: "เก็บเงินแทน · เลือกสาขา",
        icon: Wallet,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/chairops/deposits",
        label: "ฝากเงิน",
        icon: Banknote,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/chairops/review-queue",
        label: "คิวตรวจสอบ (อนุมัติ)",
        icon: ListChecks,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      // BF1 · maid roster + day-off + pay ledger (2026-06-02)
      {
        href: "/chairops/maids",
        label: "แม่บ้าน",
        icon: UsersIcon,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff", "viewer"],
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
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
      },
      {
        // CEO 2026-06-29 · "ตู้เสีย" merged into ของเสีย as a tab — single menu.
        href: "/chairops/damage",
        label: "ของเสีย",
        icon: Wrench,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"],
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
        // F2 vendor bills matrix · audit MISS-01 (2026-06-02). CEO + ADMIN edit ·
        // MANAGER + OFFICE view-only at the same URL (page handles the gate).
        href: "/chairops/bills",
        label: "บิล / ค่าใช้จ่าย",
        icon: Receipt,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"],
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
      {
        href: "/chairops/settings/drive",
        label: "สำรองขึ้น Drive",
        icon: Settings,
        adminOnly: true,
      },
      {
        href: "/chairops/line-setup",
        label: "ตั้งค่าเมนู LINE",
        icon: MessagesSquare,
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
      // แยกหน้าบ้าน/หลังบ้านให้ขาด (CEO 2026-06-25 · D-025 · ทบทวน D-023):
      //   หน้าร้าน = แอป Play a lot เต็มจอ (งานเคาน์เตอร์ · พนักงานทุกคน) — ทางเข้าเดียว ไม่มีของแอดมินปน
      //   หลังบ้าน = nav จัดหมวด (desktop-first · ผู้จัดการ+) เปิดได้ทุกหน้า ไม่ใช่ก้อนเดียว → เจ้าของ "ทำอะไรได้จริง"
      { href: "/playland", label: "หน้าร้าน · Play a lot", icon: Activity, section: "Play a lot",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "staff"] },
      // ── หลังบ้าน · ดูผล/จัดการรายวัน (ผู้จัดการขึ้นไป) ──
      { href: "/playland/office", label: "ภาพรวมร้าน", icon: LayoutDashboard, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/reports", label: "รายงาน · ปิดวัน", icon: BarChart3, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/owner-report", label: "รายงานเจ้าของ · กำไร-ขาดทุน", icon: Coins, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/stock", label: "สต๊อก · คลังสินค้า", icon: Boxes, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/shifts", label: "กะ · เงิน · นับลิ้นชัก", icon: Coins, section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      // ── ดูแลร้าน · ความปลอดภัย (ผู้จัดการขึ้นไป) ──
      { href: "/playland/incidents", label: "บันทึกอุบัติเหตุ", icon: AlertTriangle, section: "ดูแลร้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/safety", label: "ตรวจ · ทำความสะอาด", icon: ClipboardCheck, section: "ดูแลร้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/lost-found", label: "ของหาย · ของเก็บ", icon: PackageSearch, section: "ดูแลร้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      { href: "/playland/repairs", label: "ซ่อม · อะไหล่", icon: Wrench, section: "ดูแลร้าน",
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"] },
      // ── ตั้งค่า (แอดมินเท่านั้น) ──
      { href: "/playland/settings", label: "ตั้งค่าร้าน", icon: Settings, section: "ตั้งค่า", adminOnly: true },
      { href: "/playland/settings/branches", label: "ทีม & สาขา", icon: Building2, section: "ตั้งค่า", adminOnly: true },
      { href: "/playland/settings/team", label: "ทีม & สิทธิ์ (ตำแหน่ง)", icon: ShieldX, section: "ตั้งค่า", adminOnly: true },
      { href: "/playland/settings/promos", label: "โปรโมชั่น · ส่วนลด", icon: Sparkles, section: "ตั้งค่า", adminOnly: true },
      { href: "/playland/overrides", label: "เปิดประตูเอง (กันโกง)", icon: ShieldX, section: "ตั้งค่า", adminOnly: true },
      { href: "/playland/audit", label: "Audit Log", icon: ScrollText, section: "ตั้งค่า", adminOnly: true },
    ],
  },

  inbox: {
    slug: "inbox",
    name: "กล่องข้อความรวม",
    tagline: "รวมแชท LINE + Facebook ทุกเพจ · บอทตอบอัตโนมัติ",
    description:
      "รวมข้อความลูกค้าจากทุก LINE OA + Facebook Page มาไว้ที่เดียว · บอท AI ตอบอัตโนมัติ (เปิดเฉพาะเก้าอี้นวด) · สรุปรายวัน",
    emoji: "💬",
    Icon: MessagesSquare,
    status: "active",
    basePath: "/inbox",
    nav: [
      { href: "/inbox", label: "กล่องข้อความ", icon: MessagesSquare, section: "แชท" },
      {
        href: "/inbox/bot",
        label: "ตั้งค่าบอท",
        icon: Bot,
        roles: ["super_admin", "org_admin", "admin"],
        section: "จัดการ",
      },
      {
        href: "/inbox/settings/channels",
        label: "เชื่อมช่องทาง",
        icon: Settings,
        // หน้านี้ guard ด้วย isSuperAdmin เท่านั้น — เมนูจึงต้องโชว์เฉพาะ super_admin
        // (ถ้าใช้ adminOnly org_admin/admin จะเห็นเมนูแล้วกดเด้ง /403 = ปุ่มตาย)
        roles: ["super_admin"],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CostCtrl · super_admin (CEO) only · ศูนย์ควบคุมต้นทุน
  // BIGFEATURE 2026-05-31 · spec at docs/BIGFEATURE_costctrl_SPEC.md
  // Every nav item locks to role "super_admin" so nav rail hides for everyone
  // below. Layout-level guard via requireSuperAdmin is the real wall — nav
  // visibility is just polish.
  // ─────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // HotelBook · ระบบจองโรงแรม (Mix Hotel first tenant)
  // BIGFEATURE 2026-05-31 รอบ 68 · public booking via web + LIFF + FB CTA
  // ─────────────────────────────────────────────────────────────────────────
  hotelbook: {
    slug: "hotelbook",
    name: "ระบบจองโรงแรม",
    tagline: "Mix Hotel · จองผ่านเว็บ + LINE + Facebook · จัดการห้อง + ภาพ + รายการจอง",
    description:
      "ระบบจองโรงแรมแบบ end-to-end · public booking page สวยๆ + LINE Mini App + FB CTA · admin จัดการ ห้อง · ราคา · รูปภาพ · รายการจอง · นโยบาย",
    emoji: "🏨",
    Icon: BedDouble,
    status: "active",
    basePath: "/hotelbook",
    nav: [
      {
        href: "/hotelbook",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        section: "โรงแรม",
      },
      {
        href: "/hotelbook/bookings",
        label: "รายการจอง",
        icon: CalendarCheck,
      },
      {
        href: "/hotelbook/rooms",
        label: "จัดการห้อง",
        icon: BedDouble,
        roles: ["super_admin", "org_admin", "admin"],
        section: "จัดการ",
      },
      {
        href: "/hotelbook/images",
        label: "อัปโหลดรูป",
        icon: ImageIcon,
        roles: ["super_admin", "org_admin", "admin"],
      },
      {
        href: "/hotelbook/settings",
        label: "ตั้งค่าโรงแรม",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },

  costctrl: {
    slug: "costctrl",
    name: "ศูนย์ควบคุมต้นทุน",
    tagline: "ดูต้นทุน Vercel + Supabase + R2 + AI tokens ที่เดียว · เตือนก่อนถึงเพดาน",
    description:
      "Cost Center สำหรับ CEO คนเดียว · เห็นต้นทุนทุก provider เดือนปัจจุบัน + เตือนทาง LINE เมื่อใกล้ quota/budget",
    emoji: "💸",
    Icon: Banknote,
    status: "active",
    basePath: "/costctrl",
    nav: [
      {
        href: "/costctrl",
        label: "ภาพรวมต้นทุน",
        icon: Gauge,
        roles: ["super_admin"],
        section: "ต้นทุน",
      },
      {
        href: "/costctrl/ai",
        label: "AI tokens",
        icon: Bot,
        roles: ["super_admin"],
      },
      {
        href: "/costctrl/alerts",
        label: "เตือน + budget + คีย์",
        icon: Bell,
        roles: ["super_admin"],
      },
    ],
  },

  ledger: {
    slug: "ledger",
    name: "ระบบบัญชี",
    tagline: "LedgerLine · ถ่ายใบเสร็จในกลุ่ม LINE → AI อ่าน → บัญชียืนยัน → ส่งเข้า TRCloud",
    description:
      "ระบบบันทึกค่าใช้จ่าย · staff ถ่ายใบเสร็จ/สลิป (LINE หรือเว็บ) → AI อ่านข้อมูล + ตรวจยอด → บัญชียืนยัน (ห้าม auto-post) → เก็บ + งบประมาณ + Dashboard + export เข้า TRCloud",
    emoji: "🧾",
    Icon: Receipt,
    // CEO 2026-06-05: เปิดใช้เต็มตัว — โผล่ในหน้าเชิญผู้ใช้ (program-admin) + ขึ้น
    // "ใช้งานอยู่" บน Hub รวม. ก่อนหน้านี้เป็น "beta" จึงถูกตัวกรอง status==="active" กันออก.
    status: "active",
    basePath: "/ledger",
    // Nav grouped into 4 job-based sections (CEO 2026-06-08 "จัดหมวดหมู่ให้ทีมใช้ง่าย").
    // Mirrors the lean mobile LedgerBottomNav. `section` renders a header before its item.
    nav: [
      // ── งานรายวัน ──
      {
        href: "/ledger",
        label: "หน้าหลัก",
        icon: LayoutDashboard,
        section: "งานรายวัน",
      },
      {
        href: "/ledger/expenses",
        label: "รายจ่าย",
        icon: Receipt,
        // Financial-view tier — must match the page-level requireRole gate in
        // app/(admin)/ledger/expenses/page.tsx. Staff capture is LIFF-only, so
        // staff/driver/branch_manager are excluded from this web review pane.
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      // ── การเงิน – จ่ายเงิน ──
      {
        href: "/ledger/reconcile",
        label: "กระทบยอดจ่าย",
        icon: HandCoins,
        // ขอโอนเงิน → จ่าย → สลิป → reconcile (LEDGER_PAYREQ_V1). Accountant-facing;
        // financial-view tier (matches the page-level gate). When the flag is off the
        // page shows a friendly "ยังไม่เปิดใช้" message (not a dead route).
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
        section: "การเงิน – จ่ายเงิน",
      },
      {
        href: "/ledger/bank-recon",
        label: "กระทบยอดธนาคาร",
        icon: Landmark,
        // Import bank statements (KBank/SCB/TTB/BBL) → auto-match → confirm → lock.
        // Feature-flagged LEDGER_BANK_RECON_V1; page shows "ยังไม่เปิดใช้" when off.
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      // ── ภาพรวม & รายงาน ──
      {
        // "สมุดค่าใช้จ่าย" — retrospective spend-analytics (pivot สาขา×เดือน, ค้นราคา
        // ล่าสุด, เซฟเล่ม).
        href: "/ledger/ledger-book",
        label: "สมุดค่าใช้จ่าย",
        icon: BookOpen,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
        section: "ภาพรวม & รายงาน",
      },
      {
        href: "/ledger/dashboard",
        label: "Dashboard",
        icon: BarChart3,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        // รายงานภาษีซื้อ (Input VAT / ภ.พ.30) — ใบไหนมี VAT · ขอคืนได้ · หรือติด
        href: "/ledger/tax",
        label: "รายงานภาษีซื้อ",
        icon: ReceiptText,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/ledger/budgets",
        label: "งบประมาณ",
        icon: Wallet2,
        roles: ["super_admin", "org_admin", "admin", "area_manager"],
      },
      // ── ตั้งค่า ──
      {
        href: "/ledger/settings",
        label: "ตั้งค่า",
        icon: Settings,
        adminOnly: true,
        section: "ตั้งค่า",
      },
    ],
  },

  rentspace: {
    slug: "rentspace",
    name: "บริหารพื้นที่เช่า",
    tagline: "โครงการ · ห้อง · ผู้เช่า · สัญญา · มิเตอร์ · ออกบิลอัตโนมัติ · ผัง 3D",
    description:
      "ระบบบริหารโครงการร้านค้าเช่าครบวงจร · ผังโครงการคลิกได้ + 3D · ทะเบียนผู้เช่า + สัญญาออนไลน์เซ็นได้ + เงินประกัน + จดมิเตอร์น้ำไฟ + ออกบิลอัตโนมัติทุกเดือน + ค่าปรับล่าช้า + อนุมัติส่วนลด + ประวัติชำระ",
    emoji: "🏬",
    Icon: Building2,
    status: "active",
    basePath: "/rentspace",
    nav: [
      {
        href: "/rentspace",
        label: "ภาพรวม + ผัง",
        icon: LayoutDashboard,
        section: "โครงการ",
      },
      {
        href: "/rentspace/matrix",
        label: "ตารางค่าเช่า (Excel)",
        icon: ClipboardList,
      },
      {
        href: "/rentspace/units",
        label: "ห้อง / ยูนิต",
        icon: Building2,
      },
      {
        href: "/rentspace/tenants",
        label: "ผู้เช่า",
        icon: UsersIcon,
      },
      {
        href: "/rentspace/contracts",
        label: "สัญญาเช่า",
        icon: ScrollText,
        section: "เอกสาร",
      },
      {
        href: "/rentspace/meters",
        label: "จดมิเตอร์",
        icon: Gauge,
        section: "การเงิน",
      },
      {
        href: "/rentspace/bills",
        label: "บิล / ใบแจ้งหนี้",
        icon: Receipt,
      },
      {
        href: "/rentspace/payments",
        label: "การชำระเงิน",
        icon: Banknote,
      },
      {
        href: "/rentspace/deposits",
        label: "เงินประกัน",
        icon: Wallet2,
      },
      {
        href: "/rentspace/import",
        label: "นำเข้าข้อมูล",
        icon: ClipboardList,
        roles: ["super_admin", "org_admin", "admin"],
        section: "จัดการ",
      },
      {
        href: "/rentspace/settings",
        label: "ตั้งค่าโครงการ",
        icon: Settings,
        adminOnly: true,
        section: "ตั้งค่า",
      },
    ],
  },
  clawhub: {
    slug: "clawhub",
    name: "JOLLY PLAY",
    tagline: "ระบบสมาชิก + คืนแต้มตู้คีบ",
    description:
      "สมาชิก LINE ตู้คีบการันตี · ลูกค้าขอคืนแต้มเมื่อตู้มีปัญหา (ถ่ายรูป + AI อ่านจอ) · 1 แต้ม = 10 บาท · แลกตุ๊กตา · แต้มหมดอายุ 30 วัน",
    emoji: "🧸",
    Icon: Gift,
    status: "active",
    basePath: "/clawhub",
    nav: [
      {
        href: "/clawhub/dashboard",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin"],
      },
      {
        href: "/clawhub/refunds",
        label: "ตรวจคำขอคืนแต้ม",
        icon: TicketCheck,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "program_admin"],
      },
      {
        href: "/clawhub/members",
        label: "สมาชิก",
        icon: UsersIcon,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "program_admin"],
      },
      {
        href: "/clawhub/dolls",
        label: "ตุ๊กตา (รางวัล)",
        icon: Smile,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "program_admin"],
      },
      {
        href: "/clawhub/redemptions",
        label: "การแลกของ",
        icon: Gift,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "branch_manager", "program_admin"],
      },
      {
        href: "/clawhub/inbox",
        label: "กล่องแชท",
        icon: MessagesSquare,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "program_admin"],
      },
      {
        href: "/clawhub/reports",
        label: "รายงาน",
        icon: BarChart3,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin"],
      },
      {
        href: "/clawhub/settings",
        label: "ตั้งค่า",
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
  dc: {
    slug: "dc",
    name: "DC คลังกลาง",
    tagline: "คลังกลาง + กระจายสินค้า",
    description:
      "ศูนย์คลังกลาง — รับของจากจีน (คิดต้นทุนนำเข้าต่อชิ้น) → เก็บ/นับ/กระจายไปสาขาและโปรแกรมในเครือ · พนักงานหน้าคลังสแกนบน iPad ปุ่มใหญ่ · หลังบ้านคุมสั่งซื้อ/สิทธิ์/รายงาน",
    emoji: "📦",
    Icon: Warehouse,
    status: "active",
    basePath: "/dc",
    nav: [
      // ★ ทุก item ใส่ section ของตัวเอง (ไม่ใช่แค่ตัวแรกของกลุ่ม) — เมนูถูกกรองตาม role ก่อน render
      //   ถ้า section ติดอยู่กับ item ที่ role นั้นมองไม่เห็น หัวข้อกลุ่มจะหายไปทั้งกลุ่ม
      //   (admin-shell โชว์หัวข้อเมื่อ section "เปลี่ยน" จาก item ก่อนหน้า → ใส่ครบทุกตัวแล้วปลอดภัยเสมอ)
      // ----- หน้าคลัง (floor · iPad ปุ่มใหญ่) -----
      {
        href: "/dc",
        label: "หน้าคลัง",
        icon: Boxes,
        section: "หน้าคลัง",
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff", "viewer"],
      },
      {
        href: "/dc/receive",
        label: "รับเข้า",
        section: "หน้าคลัง",
        icon: PackagePlus,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff"],
      },
      {
        // 3 งาน "เอาของออก" รวมเป็นหน้าเดียว 3 แท็บ — เดิมแยก 3 เมนู (ส่ง/โอน · ย้ายที่ · เบิกออก)
        // /dc/issue + /dc/move ยัง redirect เข้าแท็บที่ถูกให้ลิงก์เก่า
        href: "/dc/transfer?tab=issue",
        label: "เบิก · โอน · ย้าย",
        section: "หน้าคลัง",
        icon: Truck,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/dc/count",
        label: "นับสต๊อก",
        section: "หน้าคลัง",
        icon: ClipboardCheck,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff"],
      },
      {
        href: "/dc/search",
        label: "ค้นหา",
        section: "หน้าคลัง",
        icon: Search,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff", "viewer"],
      },
      {
        href: "/dc/labels",
        label: "ปริ้นฉลาก",
        section: "หน้าคลัง",
        icon: QrCode,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "staff"],
      },
      // ----- หลังบ้าน (back-office · desktop) -----
      {
        href: "/dc/office",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        section: "หลังบ้าน",
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "viewer"],
      },
      {
        // หลังบ้านก็รวม 3 งาน "เอาของออก" เป็นหน้าเดียว 3 แท็บ (คนละกรอบกับหน้าคลัง แต่ flow เดียวกัน)
        href: "/dc/office/issue",
        label: "เบิก · โอน · ย้าย",
        section: "หลังบ้าน",
        icon: PackageMinus,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      {
        href: "/dc/office/purchasing",
        label: "สั่งซื้อจีน",
        section: "หลังบ้าน",
        icon: ShoppingCart,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      // #16 ยุบ "ผู้ขาย" + "ขนส่ง/ชิปเมนต์" ออกจากเมนู — เข้าถึงผ่านแท็บใน "สั่งซื้อจีน" (PurchasingSubnav) แทน
      // ----- เอกสาร (เวฟ 2: ยุบ 4 เมนู → หน้าเดียว 4 แท็บ ผ่าน DcDocsSubnav — แบบเดียวกับ #16 สั่งซื้อจีน) -----
      // ใบรับสินค้า · ใบโอน · ใบย้ายที่ · ใบเบิก ยังเป็น 4 route เดิม (บุ๊กมาร์ก/ลิงก์เก่าใช้ได้) แค่เข้าผ่านแท็บ
      {
        href: "/dc/office/receipts",
        label: "เอกสารคลัง",
        icon: ClipboardCheck,
        section: "เอกสาร",
        // ให้เมนูไฮไลต์ค้างไว้ทุกแท็บของกลุ่มเอกสาร ไม่ใช่เฉพาะใบรับสินค้า
        activePrefixes: ["/dc/office/transfers", "/dc/office/moves", "/dc/office/issues"],
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      // ----- ข้อมูล & รายงาน -----
      {
        href: "/dc/office/products",
        label: "สินค้า",
        icon: Boxes,
        section: "ข้อมูล & รายงาน",
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      {
        href: "/dc/office/warehouses",
        label: "โกดัง",
        section: "ข้อมูล & รายงาน",
        icon: Warehouse,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      {
        href: "/dc/office/reconcile",
        label: "กระทบยอด",
        section: "ข้อมูล & รายงาน",
        icon: GitCompare,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager"],
      },
      {
        href: "/dc/office/reports",
        label: "รายงาน",
        section: "ข้อมูล & รายงาน",
        icon: BarChart3,
        roles: ["super_admin", "org_admin", "admin", "program_admin", "area_manager", "branch_manager", "viewer"],
      },
      // ----- ผู้ดูแล -----
      {
        // ประวัติการลบเอกสาร — super_admin เท่านั้น (page เองก็ redirect กันอีกชั้น)
        href: "/dc/office/deletions",
        label: "ประวัติการลบ",
        icon: History,
        section: "ผู้ดูแล",
        roles: ["super_admin"],
      },
      {
        href: "/dc/office/permissions",
        label: "สิทธิ์พนักงาน",
        section: "ผู้ดูแล",
        icon: UsersIcon,
        adminOnly: true,
      },
      {
        // ตั้งค่า DC — เรตค่าขนส่งจีน-ไทย + เชื่อม Google Drive (ที่เก็บรูปสินค้า)
        href: "/dc/office/settings",
        label: "ตั้งค่า",
        section: "ผู้ดูแล",
        icon: Settings,
        adminOnly: true,
      },
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
