"use client";

// Hub mobile bottom nav — global launcher tabs for the owner/admin audience.
// Pattern copied from components/clawfleet/_kit/mobile-bottom-nav.tsx (Tailwind +
// global tokens + lg:hidden + safe-area + ≥44px targets + aria-current).
// 4 tabs (admin) / 3 tabs (non-admin · งานรอ is adminOnly). The 4 tabs are
// DISTINCT destinations (no two-paths): หน้าหลัก=dashboard, โปรแกรม=full grid,
// งานรอ=approvals queue, ฉัน=profile.
//
// Safe-area: app/layout.tsx holds viewportFit:'cover' project-wide, so
// env(safe-area-inset-bottom) returns 0 today. The max(12px, …) fallback gives
// the bar a sane minimum now and auto-hugs the iPhone home-indicator the moment
// cover is enabled — no cross-module change needed here.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Bell, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Tab {
  href: string;
  icon: LucideIcon;
  label: string;
  adminOnly?: boolean;
  /** show the pending badge */
  badge?: boolean;
}

const ALL_TABS: readonly Tab[] = [
  { href: "/home", icon: Home, label: "หน้าหลัก" },
  { href: "/programs", icon: LayoutGrid, label: "โปรแกรม" },
  { href: "/users/requests", icon: Bell, label: "งานรอ", adminOnly: true, badge: true },
  { href: "/profile", icon: UserCircle, label: "ฉัน" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function HubBottomNav({
  isAdmin,
  pendingCount = 0,
}: {
  isAdmin: boolean;
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);
  const cols = tabs.length;

  return (
    <nav
      aria-label="เมนูหลัก Pooilgroup"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 lg:hidden",
        "bg-white border-t border-zinc-200 shadow-[0_-2px_16px_rgba(0,0,0,0.06)]",
        "supports-[backdrop-filter]:bg-white/95 supports-[backdrop-filter]:backdrop-blur-lg",
        "pb-[max(12px,env(safe-area-inset-bottom))]",
      )}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(pathname, tab.href);
          const showBadge = tab.badge && pendingCount > 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              aria-label={
                showBadge ? `${tab.label} · ${pendingCount} รายการรอ` : tab.label
              }
              className={cn(
                "relative flex flex-col items-center justify-center gap-1",
                "min-h-[64px] px-2 pt-2 pb-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "text-[var(--color-brand-700)]"
                  : "text-zinc-600 hover:text-zinc-900",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 mx-auto h-[3px] w-8 rounded-b-full bg-[var(--color-brand-600)]"
                />
              )}
              <span className="relative">
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.5 : 2}
                  aria-hidden
                />
                {showBadge && (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center"
                  >
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </span>
              <span className="leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
