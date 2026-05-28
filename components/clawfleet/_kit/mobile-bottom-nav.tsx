"use client";

// ClawFleet · Mobile Bottom Nav
// 5 tabs (admin) / 4 tabs (non-admin) · sticky bottom · hidden ≥lg (desktop uses sidebar)
// Pattern adapted from playland/mobile-bottom-nav · scoped to ClawFleet
// Per LESSONS run #1: was deferred from ClawFleet · shipped here
//
// Active detection: pathname startsWith href (except / itself)
// Safe-area-bottom: env(safe-area-inset-bottom) padding for iPhone notch
// Touch target: 64px height per tab · grid 5/4 columns
// A11y: aria-current for active · aria-label on each tab

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Activity, BarChart3, Settings, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface MobileBottomNavProps {
  isAdmin: boolean;
}

const ALL_TABS = [
  { href: "/clawfleet/hub", icon: Home, label: "หน้าแรก", adminOnly: false },
  { href: "/clawfleet/operations", icon: Activity, label: "ปฏิบัติการ", adminOnly: false },
  { href: "/clawfleet/insights", icon: BarChart3, label: "ข้อมูล", adminOnly: false },
  { href: "/clawfleet/setup", icon: Settings, label: "ตั้งค่า", adminOnly: true },
  { href: "/clawfleet/help", icon: HelpCircle, label: "คู่มือ", adminOnly: false },
] as const;

export function MobileBottomNav({ isAdmin }: MobileBottomNavProps) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);
  const cols = tabs.length;

  return (
    <nav
      aria-label="ClawFleet mobile navigation"
      className={cn(
        // Position
        "fixed inset-x-0 bottom-0 z-40 lg:hidden",
        // Surface — solid bg per [[sticky-bg-inherit-anti-pattern]]
        "bg-white border-t border-zinc-200 shadow-[0_-2px_16px_rgba(0,0,0,0.06)]",
        // Backdrop blur for translucent feel ON TOP OF solid bg (not opacity)
        "supports-[backdrop-filter]:bg-white/95 supports-[backdrop-filter]:backdrop-blur-lg",
        // iPhone safe area
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              aria-label={tab.label}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1",
                "min-h-[64px] px-2 pt-2 pb-3 text-[11px] font-medium",
                "transition-colors",
                active
                  ? "text-blue-700"
                  : "text-zinc-600 hover:text-zinc-900",
              )}
            >
              {/* Active top accent bar */}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 mx-auto h-[3px] w-8 rounded-b-full bg-blue-600"
                />
              )}
              <Icon
                className="h-5 w-5"
                strokeWidth={active ? 2.5 : 2}
                aria-hidden="true"
              />
              <span className="leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
