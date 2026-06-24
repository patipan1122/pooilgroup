"use client";

// Playland · โครงหลังบ้านใหม่ (Direction A · Command) — sidebar + top bar + ตัวสลับสาขา
// full-screen takeover (คลุม AdminShell) · แยกหน้าบ้าน/หลังบ้านขาด · ดีไซน์จาก Play a lot Admin.dc.html
import { usePathname } from "next/navigation";
import Link from "next/link";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import {
  Home, Grid3x3, LayoutDashboard, FileBarChart2, Boxes,
  Users, SlidersHorizontal, ShieldCheck, Store, ChevronRight,
} from "lucide-react";

// ── design tokens (จากไฟล์ดีไซน์) ──
const INK = "#34291E", MUTED = "#A99C88", MUTED2 = "#6E6456", FAINT = "#B5A893";
const BLUE = "#2C6BB3", MUSTARD = "#D9A227", CREAM = "#F4EEE3", LINE = "#ECE3D4";
const MITR = "'Mitr', var(--font-mitr), sans-serif";
const FREDOKA = "'Fredoka', var(--font-fredoka), sans-serif";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; match: (p: string) => boolean; badge?: number };

export function OfficeShell({
  branches, activeId, userName, userRole, title, subtitle, headerRight, badges, children,
}: {
  branches: { id: string; name: string }[];
  activeId: string | null;
  userName: string;
  userRole: string;
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  badges?: { team?: number; requests?: number };
  children: React.ReactNode;
}) {
  const path = usePathname();

  const backoffice: NavItem[] = [
    { href: "/playland/office", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/playland/office" },
    { href: "/playland/reports", label: "รายงาน · ปิดวัน", icon: FileBarChart2, match: (p) => p.startsWith("/playland/reports") || p.startsWith("/playland/shifts") },
    { href: "/playland/stock", label: "สต๊อก · คลังสินค้า", icon: Boxes, match: (p) => p.startsWith("/playland/stock") || p.startsWith("/playland/repairs") },
  ];
  const manage: NavItem[] = [
    { href: "/playland/settings/branches", label: "ทีม & สาขา", icon: Users, match: (p) => p.startsWith("/playland/settings/branches"), badge: badges?.team },
    { href: "/playland/settings", label: "ตั้งค่า · Packages", icon: SlidersHorizontal, match: (p) => p.startsWith("/playland/settings") && !p.startsWith("/playland/settings/branches") },
    { href: "/playland/audit", label: "Audit Log", icon: ShieldCheck, match: (p) => p.startsWith("/playland/audit") || p.startsWith("/playland/overrides") },
  ];

  const navRow = (it: NavItem) => {
    const on = it.match(path);
    const Icon = it.icon;
    return (
      <Link key={it.href} href={it.href} style={{
        display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 9, fontSize: 14,
        textDecoration: "none", color: on ? "#fff" : MUTED2, background: on ? BLUE : "transparent", fontWeight: on ? 500 : 400,
        justifyContent: it.badge != null ? "space-between" : "flex-start",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 11 }}><Icon size={17} /> {it.label}</span>
        {it.badge != null && it.badge > 0 && <span style={{ background: "#FBEAE7", color: "#D9483B", fontSize: 11, padding: "1px 7px", borderRadius: 99 }}>{it.badge}</span>}
      </Link>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", fontFamily: MITR, color: INK, background: CREAM }}>
      {/* ───────── Sidebar ───────── */}
      <div style={{ width: 248, flex: "none", background: "#fff", borderRight: `1px solid ${LINE}`, display: "flex", flexDirection: "column", padding: "20px 0" }}>
        <div style={{ padding: "0 22px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FREDOKA, fontWeight: 700, color: "#fff", fontSize: 18 }}>P</div>
          <div><div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, lineHeight: 1 }}>Pooilgroup</div><div style={{ fontSize: 11, color: MUTED }}>Command Center</div></div>
        </div>
        {/* Playland badge → ไปหน้าร้าน (แยกหน้าบ้าน/หลังบ้านชัด) */}
        <Link href="/playland" style={{ margin: "0 14px 14px", padding: "11px 12px", background: CREAM, borderRadius: 11, display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: INK }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🎡</div>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14 }}>Playland</div><div style={{ fontSize: 11, color: MUTED }}>Face Gate · Play a lot</div></div>
          <Store size={15} color={FAINT} />
        </Link>

        <div style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 2 }}>
          <Link href="/home" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 9, fontSize: 14, color: MUTED2, textDecoration: "none" }}><Home size={17} /> หน้าหลัก</Link>
          <Link href="/home" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 9, fontSize: 14, color: MUTED2, textDecoration: "none" }}><Grid3x3 size={17} /> โปรแกรมทั้งหมด</Link>
          <div style={{ margin: "12px 12px 6px", fontSize: 11, letterSpacing: ".08em", color: FAINT }}>หลังบ้าน</div>
          {backoffice.map(navRow)}
          <div style={{ margin: "12px 12px 6px", fontSize: 11, letterSpacing: ".08em", color: FAINT }}>จัดการ</div>
          {manage.map(navRow)}
        </div>

        <div style={{ marginTop: "auto", padding: "14px 20px 0", margin: "0 0 0", display: "flex", alignItems: "center", gap: 10, borderTop: `1px solid ${LINE}` }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: MUSTARD, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: FREDOKA, fontWeight: 600 }}>{userName.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div><div style={{ fontSize: 11, color: MUTED }}>{userRole}</div></div>
        </div>
      </div>

      {/* ───────── Main ───────── */}
      <div style={{ flex: 1, minWidth: 0, background: CREAM, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ height: 66, flex: "none", background: "#fff", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 18, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: MUTED }}>{subtitle}</div>}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {headerRight}
            <BranchSwitcher branches={branches} activeId={activeId} />
            <Link href="/playland" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: BLUE, color: "#fff", borderRadius: 9, padding: "8px 16px", fontSize: 13, textDecoration: "none", fontWeight: 500 }}>
              <Store size={15} /> หน้าร้าน <ChevronRight size={14} />
            </Link>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>{children}</div>
      </div>
    </div>
  );
}
