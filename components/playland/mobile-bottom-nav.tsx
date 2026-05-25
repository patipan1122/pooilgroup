"use client";

// Mobile bottom nav · 5 icons for the most-used cashier flows
// Hidden ≥900px (desktop uses sidebar) · sticky bottom on mobile
// Per LESSONS run #1: cross-workspace nav was missing from clawfleet · ship here

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Users, ShoppingBasket, CalendarClock, BarChart3 } from "lucide-react";

const ITEMS = [
  { href: "/playland", icon: Activity, label: "Cockpit" },
  { href: "/playland/members", icon: Users, label: "สมาชิก" },
  { href: "/playland/pos", icon: ShoppingBasket, label: "POS" },
  { href: "/playland/bookings", icon: CalendarClock, label: "จอง" },
  { href: "/playland/reports", icon: BarChart3, label: "รายงาน" },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Playland mobile navigation"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 60,
        background: "rgba(255, 252, 245, 0.96)",
        backdropFilter: "saturate(180%) blur(14px)",
        WebkitBackdropFilter: "saturate(180%) blur(14px)",
        borderTop: "1px solid var(--pl-line)",
        boxShadow: "0 -2px 16px rgba(28, 25, 23, 0.06)",
        display: "none",
      }}
      className="pl-mobile-nav"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
        {ITEMS.map((it) => {
          const Icon = it.icon;
          const isActive = pathname === it.href || (it.href !== "/playland" && pathname.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 2, padding: "10px 4px 12px",
                color: isActive ? "var(--pl-brand-dark)" : "var(--pl-text-muted)",
                textDecoration: "none",
                fontSize: 10.5, fontWeight: 600,
                position: "relative",
              }}
            >
              <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
              <span>{it.label}</span>
              {isActive && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute", top: 0, left: "50%",
                    transform: "translateX(-50%)",
                    width: 28, height: 3,
                    background: "var(--pl-brand)",
                    borderRadius: "0 0 3px 3px",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
