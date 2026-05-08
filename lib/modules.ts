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
} from "lucide-react";
import type { DbUser } from "./auth/session";

export type ModuleSlug = "cashhub" | "fuelos" | "docuflow";
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

      // Shared — เงินขาด/โน้ต ผู้จัดการสาขาเห็นได้ (auto-scoped to own branches)
      { href: "/cashhub/shortages", label: "เงินขาด", icon: AlertCircle },
      { href: "/cashhub/notes", label: "โน้ตจาก Staff", icon: ScrollText },

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
      // Executive views — ภาพรวม + รายการ + ใกล้หมดอายุ + รถ
      {
        href: "/docuflow",
        label: "ภาพรวม",
        icon: LayoutDashboard,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/documents",
        label: "รายการเอกสาร",
        icon: FileTextIcon,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      {
        href: "/docuflow/search",
        label: "ค้นหา AI",
        icon: Sparkles,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      // Upload — admin tier only (gating creation)
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
        href: "/docuflow/vehicles",
        label: "รถ + เอกสาร",
        icon: Truck,
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
      },
      // Person docs are HR-sensitive — admin tier only
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
