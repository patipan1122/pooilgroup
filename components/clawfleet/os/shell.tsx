"use client";

/**
 * ClawOsShell — full-bleed shell (sidebar + header) ของ "ตู้คีบ OS".
 * เลียนแบบ DcOfficeShell (CEO ชอบ DC) — มี sidebar เฉพาะตัวตาม design ใหม่.
 * ใช้ผ่าน os/layout.tsx ครอบทุกหน้า back-office. มือถือ → sidebar ยุบเป็น drawer.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronRight, Home } from "lucide-react";
import { BACK_NAV, FRONT_NAV, routeMeta, CLAW_ADMIN_TIER, type NavCounts } from "./nav";

const ClawLogo = (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v6" /><path d="M8 9h8l-1.2 4.2a3 3 0 0 1-2.88 2.18h-.84a3 3 0 0 1-2.88-2.18Z" /><path d="M12 15.5V21" /><path d="M8.5 21h7" />
  </svg>
);

function NavBody({
  active,
  counts,
  role,
  onNavigate,
}: {
  active: string;
  counts: NavCounts;
  role: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const adminTier = (CLAW_ADMIN_TIER as readonly string[]).includes(role);
  const backNav = BACK_NAV.filter((it) => adminTier || (it.roles?.includes(role) ?? false));
  return (
    <>
      <nav style={{ padding: "12px 12px", flex: 1, overflowY: "auto" }}>
        {backNav.length > 0 && (
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#A9AEB8", letterSpacing: "0.6px", padding: "8px 12px 6px" }}>หลังบ้าน</div>
        )}
        {backNav.map((it) => {
          const isActive = active ? active === it.key : pathname.startsWith(it.href);
          const Icon = it.icon;
          const badge = it.badge ? counts[it.badge] : undefined;
          return (
            <Link
              key={it.key}
              href={it.href}
              onClick={onNavigate}
              className="co-navitem"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 12px",
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#4F46E5" : "#454B54",
                background: isActive ? "#EEF0FE" : "transparent",
                textDecoration: "none",
                marginBottom: 1,
              }}
            >
              <span style={{ width: 18, height: 18, flex: "0 0 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={17} strokeWidth={2} />
              </span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {badge != null && badge > 0 && (
                <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "#B42318", background: "#FCEDEC", padding: "1px 8px", borderRadius: 20 }}>{badge}</span>
              )}
            </Link>
          );
        })}

        <div style={{ height: 1, background: "#F0F1F4", margin: "12px 12px" }} />
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "#A9AEB8", letterSpacing: "0.6px", padding: "2px 12px 6px" }}>หน้าบ้าน</div>
        <Link
          href={FRONT_NAV.href}
          onClick={onNavigate}
          className="co-navitem"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "9px 12px",
            borderRadius: 9,
            fontSize: 13.5,
            fontWeight: active === "app" ? 600 : 500,
            color: active === "app" ? "#4F46E5" : "#454B54",
            background: active === "app" ? "#EEF0FE" : "transparent",
            textDecoration: "none",
          }}
        >
          <span style={{ width: 18, height: 18, flex: "0 0 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FRONT_NAV.icon size={17} strokeWidth={2} />
          </span>
          <span style={{ flex: 1 }}>{FRONT_NAV.label}</span>
          <span style={{ fontSize: 14 }}>→</span>
        </Link>
      </nav>
    </>
  );
}

export function ClawOsShell({
  user,
  role,
  active,
  title,
  sub,
  right,
  counts = {},
  children,
}: {
  user: { name: string; roleLabel: string };
  role: string;
  active?: string;
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  counts?: NavCounts;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const meta = routeMeta(pathname);
  const activeKey = active ?? meta.key;
  const headTitle = title ?? meta.title;
  const headSub = sub ?? meta.sub;
  const initial = user.name?.charAt(0) || "พ";

  const SidebarHead = (
    <div style={{ padding: "20px 20px 16px", display: "flex", alignItems: "center", gap: 11, borderBottom: "1px solid #F0F1F4" }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 38px" }}>{ClawLogo}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}>ตู้คีบ OS</div>
        <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 1 }}>ระบบบริหารร้านตู้คีบ</div>
      </div>
    </div>
  );

  const SidebarFoot = (
    <div style={{ padding: 12, borderTop: "1px solid #F0F1F4", display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
        <div style={{ fontSize: 11, color: "#9AA1AB" }}>{user.roleLabel}</div>
      </div>
      <Link href="/home" title="กลับหน้าหลัก / เปลี่ยนโปรแกรม" style={{ color: "#9AA1AB", display: "flex" }}>
        <Home size={16} />
      </Link>
    </div>
  );

  return (
    <div className="clawos" style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      {/* desktop sidebar */}
      <aside
        className="co-hide-mobile"
        style={{ width: 248, flex: "0 0 248px", background: "#FFFFFF", borderRight: "1px solid #E8EAED", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh" }}
      >
        {SidebarHead}
        <NavBody active={activeKey} counts={counts} role={role} />
        {SidebarFoot}
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="co-only-mobile" style={{ position: "fixed", inset: 0, zIndex: 60 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(20,22,28,0.45)" }} onClick={() => setDrawer(false)} />
          <aside style={{ position: "absolute", left: 0, top: 0, height: "100%", width: 280, background: "#fff", display: "flex", flexDirection: "column", boxShadow: "0 0 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 8 }}>
              <div style={{ flex: 1 }}>{SidebarHead}</div>
              <button onClick={() => setDrawer(false)} style={{ background: "none", border: "none", padding: 8, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <NavBody active={activeKey} counts={counts} role={role} onNavigate={() => setDrawer(false)} />
            {SidebarFoot}
          </aside>
        </div>
      )}

      {/* main */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: "rgba(245,246,248,0.86)",
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid #E8EAED",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button className="co-only-mobile" onClick={() => setDrawer(true)} style={{ background: "#fff", border: "1px solid #E3E6EA", borderRadius: 9, padding: 8, cursor: "pointer", display: "flex" }} aria-label="เมนู">
            <Menu size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px" }}>{headTitle}</h1>
            {headSub && <div style={{ fontSize: 12.5, color: "#9AA1AB", marginTop: 2 }}>{headSub}</div>}
          </div>
          {right}
        </header>
        <div style={{ padding: "20px clamp(14px, 4vw, 32px) 56px", flex: 1 }}>{children}</div>
      </main>
    </div>
  );
}

/** date-range chip used in headers (presentational) */
export function DateRangeChip({ label = "18–24 มิ.ย. 69" }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 10, padding: "7px 13px" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      <div><div style={{ fontSize: 9, color: "#9AA1AB", lineHeight: 1.1 }}>เลือกช่วงวันที่</div><div className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1D21" }}>{label}</div></div>
      <ChevronRight size={14} style={{ color: "#9AA1AB", transform: "rotate(90deg)" }} />
    </div>
  );
}
