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
  Settings,
  ClipboardEdit,
} from "lucide-react";

export type ModuleSlug = "cashhub" | "fuelos" | "docuflow";
export type ModuleStatus = "active" | "coming_soon" | "beta";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** If true, item is visible only to super_admin / org_admin / admin */
  adminOnly?: boolean;
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
      { href: "/cashhub/dashboard", label: "ภาพรวม", icon: LayoutDashboard },
      { href: "/cashhub/reports", label: "รายงานทั้งหมด", icon: ScrollText },
      { href: "/cashhub/leaderboard", label: "Leaderboard", icon: Trophy },
      { href: "/cashhub/heatmap", label: "Heatmap", icon: CalendarDays },
      { href: "/cashhub/shortages", label: "เงินขาด", icon: AlertCircle },
      { href: "/cashhub/notes", label: "โน้ตจาก Staff", icon: ScrollText },
      { href: "/cashhub/monthly-report", label: "รายงานเดือน (PDF)", icon: FileTextIcon },
      { href: "/cashhub/settings/forms", label: "ฟอร์มกรอกยอด", icon: ClipboardEdit, adminOnly: true },
      { href: "/cashhub/settings", label: "ตั้งค่า CashHub", icon: Settings, adminOnly: true },
    ],
  },
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
    tagline: "จัดการเอกสาร",
    description:
      "1,100+ เอกสาร · ติดตามวันหมดอายุ · ลายเซ็นออนไลน์ · AI วิเคราะห์ก่อนเซ็น",
    emoji: "📄",
    Icon: FileText,
    status: "coming_soon",
    basePath: "/docuflow",
    nav: [{ href: "/docuflow", label: "เร็ว ๆ นี้", icon: ClipboardList }],
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
