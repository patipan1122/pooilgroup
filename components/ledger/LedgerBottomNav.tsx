// LedgerBottomNav · mobile bottom-navigation for the LedgerLine web surface.
//
// LedgerLine (ระบบบัญชี) previously had NO bottom shortcut bar on the web — only
// the Pool admin sidebar (hamburger on mobile). CEO 2026-06-06 asked for a
// Bainy-style bottom bar so every feature is one thumb-tap away on a phone.
//
// Pattern copied from chairops office-bottom-nav.tsx (route-based, usePathname,
// overflow sheet, safe-area, NO backdrop-blur for old webviews) but:
//   • ledger BRAND tokens (--color-brand-600 active) instead of chairops emerald
//   • a raised CENTER capture FAB (the heart of the Bainy layout)
//   • role-FILTERED cells: a cell the user can't reach is HIDDEN, never rendered
//     as a dead/403 tab (mirrors lib/modules.ts ledger nav role gates)
//   • shows ONLY on mobile (`lg:hidden`) so desktop keeps the sidebar untouched
//
// The web "ถ่าย" FAB links to /ledger/expenses (where the visible upload button
// lives) — an honest 1-link, not a fake one-tap camera. Auto-open is a separate
// CEO-gated change (see docs/AUDIT_ledger-mobile_2026-06-06.md · Wave 2 / G2).
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Camera,
  Wallet2,
  MoreHorizontal,
  BarChart3,
  Settings,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Role =
  | "super_admin"
  | "org_admin"
  | "admin"
  | "branch_manager"
  | "area_manager"
  | "staff"
  | "driver"
  | "viewer"
  | "program_admin";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path-prefix that marks this tab active. */
  match: string;
  /** Exact-match only (home tab — every route starts with /ledger). */
  exact?: boolean;
  /** Roles allowed to see this cell. Omit = everyone. */
  roles?: ReadonlyArray<Role>;
}

// Role tiers — kept in sync with lib/modules.ts `ledger.nav` gates.
const FINANCIAL: ReadonlyArray<Role> = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "viewer",
];
const BUDGET: ReadonlyArray<Role> = ["super_admin", "org_admin", "admin", "area_manager"];
const ADMIN: ReadonlyArray<Role> = ["super_admin", "org_admin", "admin"];

// Two primary cells on each side of the center capture FAB.
const LEFT: ReadonlyArray<NavItem> = [
  { href: "/ledger", label: "ภาพรวม", icon: LayoutDashboard, match: "/ledger", exact: true },
  { href: "/ledger/expenses", label: "รายการ", icon: Receipt, match: "/ledger/expenses", roles: FINANCIAL },
];
const RIGHT: ReadonlyArray<NavItem> = [
  { href: "/ledger/budgets", label: "งบ", icon: Wallet2, match: "/ledger/budgets", roles: BUDGET },
];
// "เพิ่มเติม" overflow sheet — flat, one level deep.
const OVERFLOW: ReadonlyArray<NavItem> = [
  { href: "/ledger/dashboard", label: "Dashboard", icon: BarChart3, match: "/ledger/dashboard", roles: FINANCIAL },
  { href: "/ledger/settings", label: "ตั้งค่า", icon: Settings, match: "/ledger/settings", roles: ADMIN },
];

function visible(items: ReadonlyArray<NavItem>, role: Role): NavItem[] {
  return items.filter((i) => !i.roles || i.roles.includes(role));
}
function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.match : pathname.startsWith(item.match);
}

function Cell({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors active:bg-zinc-100",
        active ? "text-[var(--color-brand-600)]" : "text-zinc-500 hover:text-zinc-800",
      )}
    >
      <Icon
        className={cn("h-6 w-6", active ? "text-[var(--color-brand-600)]" : "text-zinc-500")}
        aria-hidden
      />
      <span className="leading-tight">{item.label}</span>
    </Link>
  );
}

export function LedgerBottomNav({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/ledger";
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Collision guard — never stack under the single-receipt edit/admin surfaces.
  if (pathname.startsWith("/ledger/settings")) {
    // settings still reachable from the overflow sheet; keep bar but it's fine.
  }

  const left = visible(LEFT, role);
  const right = visible(RIGHT, role);
  const overflow = visible(OVERFLOW, role);
  const canCapture = FINANCIAL.includes(role);
  const overflowActive = overflow.some((o) => isActive(pathname, o));

  return (
    <>
      {/* Overflow bottom-sheet */}
      {sheetOpen && overflow.length > 0 && (
        <div
          className="lg:hidden fixed inset-0 z-[60]"
          role="dialog"
          aria-modal="true"
          aria-label="เมนูเพิ่มเติม"
        >
          <button
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-200 bg-white p-4"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-900">เมนูเพิ่มเติม</h2>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setSheetOpen(false)}
                className="grid size-11 place-items-center rounded-full text-zinc-500 active:bg-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {overflow.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setSheetOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-center text-[11px] font-medium transition-colors active:bg-zinc-100",
                        active
                          ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                          : "border-zinc-200 bg-white text-zinc-600",
                      )}
                    >
                      <Icon
                        className={cn("h-6 w-6", active ? "text-[var(--color-brand-600)]" : "text-zinc-500")}
                        aria-hidden
                      />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Fixed bottom bar — mobile only */}
      <nav
        aria-label="เมนูทางลัด LedgerLine"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex h-16 max-w-md items-stretch">
          {/* left cells */}
          <div className="flex flex-1">
            {left.map((item) => (
              <Cell key={item.href} item={item} pathname={pathname} />
            ))}
          </div>

          {/* center raised capture FAB */}
          <div className="flex w-16 flex-none flex-col items-center justify-start pt-1">
            {canCapture ? (
              <button
                type="button"
                aria-label="ถ่ายใบเสร็จ / อัปโหลด"
                onClick={() => {
                  // On the receipts page → open the camera in THIS gesture (reliable
                  // on iOS/LINE webview). Elsewhere → go there; the visible upload
                  // button is the next tap (never a dead button).
                  if (pathname.startsWith("/ledger/expenses")) {
                    window.dispatchEvent(new CustomEvent("ledger:open-upload"));
                  } else {
                    router.push("/ledger/expenses");
                  }
                }}
                className="grid size-14 -mt-5 place-items-center rounded-full bg-[var(--color-brand-600)] text-white shadow-lg ring-4 ring-white transition-transform active:scale-95"
              >
                <Camera className="size-6" aria-hidden />
              </button>
            ) : (
              <span className="size-14 -mt-5" aria-hidden />
            )}
            <span className="mt-0.5 text-[11px] font-medium text-zinc-500">ถ่าย</span>
          </div>

          {/* right cells + เพิ่มเติม */}
          <div className="flex flex-1">
            {right.map((item) => (
              <Cell key={item.href} item={item} pathname={pathname} />
            ))}
            {overflow.length > 0 && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                className={cn(
                  "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors active:bg-zinc-100",
                  overflowActive ? "text-[var(--color-brand-600)]" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                <MoreHorizontal
                  className={cn("h-6 w-6", overflowActive ? "text-[var(--color-brand-600)]" : "text-zinc-500")}
                  aria-hidden
                />
                <span className="leading-tight">เพิ่มเติม</span>
              </button>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
