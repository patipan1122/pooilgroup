"use client";

// CashHub · เมนูแถบล่าง (mobile bottom nav) — กรอกยอด/ดูรายงานผ่านมือถือสะดวก
// แสดงเฉพาะจอเล็ก (<1024px · class ch-mobile-nav) · เดสก์ท็อปใช้ sidebar ของ AdminShell
// 4 แท็บด่วน (เลือกตาม role) + ปุ่ม "เมนู" เปิดชีตรวมทุกหน้าที่ role นั้นเข้าได้
// แท็บ/ชีต filter ด้วย predicate เดียวกับ AdminShell (roles / adminOnly / program_admin = admin)

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES } from "@/lib/modules";
import type { DbUser } from "@/lib/auth/session";
import { LayoutGrid, X, type LucideIcon } from "lucide-react";

const NAV = MODULES.cashhub.nav;

// roles ที่เห็นเมนูภาพรวม/รายงาน (เหมือน EXECUTIVE_ROLES) → ใช้เลือกแท็บด่วน
const EXEC_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "viewer",
];

type Tab = { href: string; label: string; icon: LucideIcon };

function isActive(pathname: string, href: string): boolean {
  if (href === "/cashhub") return pathname === "/cashhub";
  return pathname === href || pathname.startsWith(href + "/");
}

export function CashHubMobileNav({ role }: { role: DbUser["role"] }) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);

  const isAdmin =
    role === "super_admin" || role === "org_admin" || role === "admin";
  const isModuleAdmin = isAdmin || role === "program_admin";
  const roleForNav: DbUser["role"] = role === "program_admin" ? "admin" : role;

  // หน้าที่ role นี้เข้าได้ (predicate เดียวกับ sidebar)
  const permitted = NAV.filter((item) => {
    if (item.adminOnly && !isModuleAdmin) return false;
    if (item.roles && !item.roles.includes(roleForNav)) return false;
    return true;
  });
  const byHref = new Map(permitted.map((i) => [i.href, i]));

  const isExec = EXEC_ROLES.includes(role) || role === "program_admin";

  // ป้ายสั้นสำหรับแท็บล่าง (ของจริงในเมนูยาวกว่า เช่น "กรอกยอดวันนี้" / "รายงานทั้งหมด")
  const SHORT: Record<string, string> = {
    "/cashhub/dashboard": "ภาพรวม",
    "/cashhub/reports": "รายงาน",
    "/cashhub/shortages": "เงินขาด",
    "/cashhub/leaderboard": "อันดับ",
    "/cashhub/quick-fill": "กรอกยอด",
    "/cashhub/my-branches": "สาขาฉัน",
    "/cashhub/notes": "โน้ต",
  };
  // แท็บด่วน: หน้าที่ role ใช้บ่อยสุด — ไม่มีแท็บ "/cashhub" กลาง ๆ เพราะ field staff
  // กดแล้วถูก redirect ไป /cashhub/dashboard ที่ตัวเองเข้าไม่ได้ (เด้งซ้ำ)
  const priority = isExec
    ? ["/cashhub/dashboard", "/cashhub/reports", "/cashhub/shortages", "/cashhub/leaderboard"]
    : ["/cashhub/quick-fill", "/cashhub/my-branches", "/cashhub/shortages", "/cashhub/notes"];
  const quick: Tab[] = priority
    .filter((h) => byHref.has(h))
    .slice(0, 4)
    .map((h) => {
      const it = byHref.get(h)!;
      return { href: it.href, label: SHORT[it.href] ?? it.label, icon: it.icon };
    });

  return (
    <>
      {/* full-menu sheet */}
      {open && (
        <div className="ch-msheet" onClick={() => setOpen(false)}>
          <div className="ch-msheet__panel" onClick={(e) => e.stopPropagation()}>
            <div className="ch-msheet__head">
              <span>เมนูทั้งหมด</span>
              <button type="button" aria-label="ปิด" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="ch-msheet__grid">
              {permitted.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`ch-msheet__item${isActive(pathname, it.href) ? " is-active" : ""}`}
                >
                  <it.icon size={22} />
                  <span>{it.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* bottom bar */}
      <nav className="ch-mobile-nav" aria-label="เมนูแถบล่าง CashHub">
        {quick.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`ch-mnav__tab${active ? " is-active" : ""}`}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
            >
              <it.icon size={21} strokeWidth={active ? 2.4 : 1.9} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`ch-mnav__tab${open ? " is-active" : ""}`}
          onClick={() => setOpen(true)}
          aria-label="เมนูทั้งหมด"
        >
          <LayoutGrid size={21} strokeWidth={open ? 2.4 : 1.9} />
          <span>เมนู</span>
        </button>
      </nav>
    </>
  );
}
