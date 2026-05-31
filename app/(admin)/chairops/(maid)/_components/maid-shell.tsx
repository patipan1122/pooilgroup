// MaidShell · single-page mobile shell for maid PWA.
// Bottom-nav matches CEO mockup Rich Menu (lineapp.jsx <RichMenu>): 4 action
// tabs เก็บเงิน · เช็คคลีน · แจ้งซ่อม · เบิกของ. Home is reached via the brand
// link in the header; profile/logout via the avatar button (top-right).
//
// Constraints (Android Go):
//   - h-16 (64px) bottom-nav · each cell ≥ 44pt
//   - NO backdrop-blur (Chrome <80 unsupported · use solid bg instead)
//   - safe-area-inset-bottom respected
//   - text-xs labels Thai-only

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Sparkles,
  UserCircle2,
  Wallet,
  Wrench,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path-prefix that should mark this nav item active. */
  match: string;
  /** When set, a red-dot badge with this count appears on the tab. */
  badgeKey?: "pendingDeposit";
}

// Wave-2 B4 (CEO 2026-05-31): 5th tab "ฝาก" for the new 2-step collect→
// deposit flow. Tab carries a red-dot count of collections still awaiting
// bank deposit (collection.depositId === null).
const NAV: ReadonlyArray<NavItem> = [
  {
    href: "/chairops/m/collect/new",
    label: "เก็บเงิน",
    icon: Wallet,
    match: "/chairops/m/collect",
  },
  {
    href: "/chairops/m/deposit",
    label: "ฝาก",
    icon: Banknote,
    match: "/chairops/m/deposit",
    badgeKey: "pendingDeposit",
  },
  {
    href: "/chairops/m/cleanliness/new",
    label: "เช็คคลีน",
    icon: Sparkles,
    match: "/chairops/m/cleanliness",
  },
  {
    href: "/chairops/m/damage",
    label: "แจ้งซ่อม",
    icon: Wrench,
    match: "/chairops/m/damage",
  },
  {
    href: "/chairops/m/parts/new",
    label: "เบิกของ",
    icon: Package,
    match: "/chairops/m/parts",
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  return pathname.startsWith(item.match);
}

export function MaidShell({
  displayName,
  pendingDepositCount = 0,
  children,
}: {
  displayName: string;
  pendingDepositCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/chairops/m";

  return (
    <div className="min-h-screen bg-zinc-50 pb-[calc(64px+env(safe-area-inset-bottom))]">
      <header
        className="sticky top-0 z-30 border-b border-emerald-700 bg-emerald-600 text-white"
        // Green ChairOps banner per mockup · no backdrop-blur (old Chrome safe)
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <Link
            href="/chairops/m"
            className="text-base font-bold tracking-tight text-white"
            aria-label="หน้าหลัก ChairOps"
          >
            ChairOps
          </Link>
          <span className="ml-auto truncate text-xs font-medium text-emerald-50">
            {displayName}
          </span>
          <Link
            href="/chairops/m/profile"
            aria-label="บัญชีของฉัน"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/40 text-white active:bg-emerald-500/60"
          >
            <UserCircle2 className="size-6" aria-hidden />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-3 py-4">{children}</main>

      <nav
        aria-label="เมนูหลัก"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            const badgeCount =
              item.badgeKey === "pendingDeposit" ? pendingDepositCount : 0;
            return (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // 44pt touch target enforced via min-h-[64px]
                    "relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors",
                    "active:bg-zinc-100",
                    active
                      ? "text-emerald-700"
                      : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  <span className="relative inline-flex">
                    <Icon
                      className={cn(
                        "h-6 w-6",
                        active ? "text-emerald-600" : "text-zinc-500",
                      )}
                      aria-hidden
                    />
                    {badgeCount > 0 && (
                      <span
                        className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white"
                        aria-label={`มี ${badgeCount} รอบรอฝาก`}
                      >
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </span>
                  <span className="leading-tight">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
