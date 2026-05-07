// Pooilgroup ERP — Module registry
// All modules share the SAME blue brand color (per design memory).

import type { LucideIcon } from "lucide-react";
import {
  Wallet,
  FileText as FileTextIcon,
  LayoutDashboard,
  ScrollText,
  Trophy,
  CalendarDays,
  AlertCircle,
  Settings,
  ClipboardEdit,
  ClipboardCheck,
  Building2,
} from "lucide-react";
import type { DbUser } from "./auth/session";

export type ModuleSlug = "cashhub";
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
        roles: ["super_admin", "org_admin", "admin", "area_manager", "viewer"],
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
  // FuelOS + DocuFlow soft-removed from UI registry · folders kept unreachable
  // (reinstate by re-adding the entries when those modules are ready to ship)
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
