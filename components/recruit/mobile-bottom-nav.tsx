"use client";

// Recruit · เมนูแถบล่าง (mobile bottom nav) — คัดใบสมัคร/นัดสัมภาษณ์ผ่านมือถือสะดวก
// แสดงเฉพาะจอเล็ก (<1024px · class recruit-mobile-nav) · เดสก์ท็อปใช้ sidebar ของ AdminShell
// 4 แท็บด่วน (เลือกตามสิทธิ์) + ปุ่ม "เมนู" เปิดชีตรวมทุกหน้าที่สิทธิ์นั้นเข้าได้

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  KanbanSquare,
  ListChecks,
  ClipboardList,
  Sparkles,
  MessageSquare,
  CalendarDays,
  LayoutDashboard,
  Users,
  Gift,
  Wand2,
  ShieldX,
  Settings,
  LayoutGrid,
  X,
  type LucideIcon,
} from "lucide-react";

type Need = "access" | "write" | "admin";
type Item = { href: string; label: string; icon: LucideIcon; need: Need };

// ครบทุกหน้าของ recruit + ระดับสิทธิ์ที่ต้องใช้ (access = ทุกคนที่เข้าโมดูลได้)
const ALL: Item[] = [
  { href: "/recruit", label: "ใบสมัคร", icon: Inbox, need: "access" },
  { href: "/recruit/pipeline", label: "Pipeline", icon: KanbanSquare, need: "write" },
  { href: "/recruit/triage", label: "คัดเร็ว", icon: Sparkles, need: "write" },
  { href: "/recruit/tasks", label: "งานต้องตาม", icon: ListChecks, need: "write" },
  { href: "/recruit/postings", label: "ประกาศ", icon: ClipboardList, need: "write" },
  { href: "/recruit/messages", label: "ข้อความ", icon: MessageSquare, need: "write" },
  { href: "/recruit/calendar", label: "ปฏิทินนัด", icon: CalendarDays, need: "access" },
  { href: "/recruit/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard, need: "access" },
  { href: "/recruit/talent-pool", label: "ทาเลนต์พูล", icon: Users, need: "access" },
  { href: "/recruit/referrals", label: "แนะนำเพื่อน", icon: Gift, need: "admin" },
  { href: "/recruit/auto-rules", label: "กฎอัตโนมัติ", icon: Wand2, need: "admin" },
  { href: "/recruit/blacklist", label: "Blacklist", icon: ShieldX, need: "admin" },
  { href: "/recruit/settings", label: "ตั้งค่า", icon: Settings, need: "admin" },
];

function isActive(pathname: string, href: string): boolean {
  // ใบสมัคร = หน้า list + หน้ารายละเอียดใบสมัคร
  if (href === "/recruit") {
    return pathname === "/recruit" || pathname.startsWith("/recruit/applications");
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function RecruitMobileNav({
  canWrite,
  canAdmin,
}: {
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);

  const allow = (need: Need) =>
    need === "access" ? true : need === "write" ? canWrite : canAdmin;
  const permitted = ALL.filter((it) => allow(it.need));
  const byHref = new Map(permitted.map((i) => [i.href, i]));

  // แท็บด่วน: ใบสมัคร + อีก 2-3 หน้าหลักตามสิทธิ์
  const priority = canWrite
    ? ["/recruit", "/recruit/pipeline", "/recruit/tasks"]
    : ["/recruit", "/recruit/dashboard", "/recruit/calendar"];
  const quick = priority
    .filter((h) => byHref.has(h))
    .map((h) => byHref.get(h)!)
    .slice(0, 4);

  return (
    <>
      {/* full-menu sheet */}
      {open && (
        <div className="recruit-msheet" onClick={() => setOpen(false)}>
          <div className="recruit-msheet__panel" onClick={(e) => e.stopPropagation()}>
            <div className="recruit-msheet__head">
              <span>เมนูทั้งหมด</span>
              <button type="button" aria-label="ปิด" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="recruit-msheet__grid">
              {permitted.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={`recruit-msheet__item${isActive(pathname, it.href) ? " is-active" : ""}`}
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
      <nav className="recruit-mobile-nav" aria-label="เมนูแถบล่าง Recruit">
        {quick.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`recruit-mnav__tab${active ? " is-active" : ""}`}
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
          className={`recruit-mnav__tab${open ? " is-active" : ""}`}
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
