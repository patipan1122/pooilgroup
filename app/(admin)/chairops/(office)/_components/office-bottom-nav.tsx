// OfficeBottomNav · mobile bottom-navigation for the ChairOps OFFICE surface.
//
// The office surface previously had NO bottom shortcut bar — only the Pool admin
// sidebar (hamburger on mobile). The owner runs the business from a phone and
// asked for one-tap access to his daily actions (CEO 2026-06-03). This mirrors
// the MAID bottom-nav (maid-shell.tsx) 1:1 — same 64px bar, touch targets,
// safe-area handling — but:
//   • shows ONLY on mobile (`lg:hidden`) so desktop keeps the sidebar untouched
//   • 4 primary tabs + a "เพิ่มเติม" button that opens a bottom-sheet with the
//     remaining office routes (so everything is reachable from one bar)
//
// Constraints copied from MaidShell: h-16 bar, ≥44pt cells, NO backdrop-blur
// (old Chrome), safe-area-inset-bottom respected, Thai-only labels.
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Wallet,
  Banknote,
  Scale,
  MoreHorizontal,
  Wrench,
  Package,
  Receipt,
  Users,
  Upload,
  Bell,
  FileMinus2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path-prefix that marks this tab active. */
  match: string;
  /** Exact-match only (for the home tab, since every route starts with /chairops). */
  exact?: boolean;
}

// 4 primary tabs = the owner's daily money flow. 5th cell opens the overflow sheet.
const PRIMARY: ReadonlyArray<NavItem> = [
  { href: "/chairops", label: "หน้าหลัก", icon: LayoutGrid, match: "/chairops", exact: true },
  { href: "/chairops/branch-collect", label: "เก็บเงิน", icon: Wallet, match: "/chairops/branch-collect" },
  { href: "/chairops/deposits", label: "ฝากเงิน", icon: Banknote, match: "/chairops/deposits" },
  { href: "/chairops/reconcile", label: "ตรวจยอด", icon: Scale, match: "/chairops/reconcile" },
];

// Everything else the owner may need — reachable from the "เพิ่มเติม" sheet.
const OVERFLOW: ReadonlyArray<NavItem> = [
  { href: "/chairops/damage", label: "งานซ่อม", icon: Wrench, match: "/chairops/damage" },
  { href: "/chairops/parts", label: "เบิกของ", icon: Package, match: "/chairops/parts" },
  { href: "/chairops/bills", label: "บิลค่าใช้จ่าย", icon: Receipt, match: "/chairops/bills" },
  { href: "/chairops/maids", label: "แม่บ้าน", icon: Users, match: "/chairops/maids" },
  { href: "/chairops/pos-ingest", label: "อัพข้อมูล POS", icon: Upload, match: "/chairops/pos-ingest" },
  { href: "/chairops/alerts", label: "เตือนเงินขาด", icon: Bell, match: "/chairops/alerts" },
  { href: "/chairops/write-offs", label: "ตัดเงินขาด", icon: FileMinus2, match: "/chairops/write-offs" },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.match : pathname.startsWith(item.match);
}

export function OfficeBottomNav() {
  const pathname = usePathname() ?? "/chairops";
  const [sheetOpen, setSheetOpen] = useState(false);

  // "เพิ่มเติม" highlights when the current page is one of the overflow routes.
  const overflowActive = OVERFLOW.some((o) => isActive(pathname, o));

  return (
    <>
      {/* Overflow bottom-sheet */}
      {sheetOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="เมนูเพิ่มเติม">
          {/* backdrop */}
          <button
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          {/* panel */}
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
                className="grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {OVERFLOW.map((item) => {
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
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-zinc-200 bg-white text-zinc-600",
                      )}
                    >
                      <Icon className={cn("h-6 w-6", active ? "text-emerald-600" : "text-zinc-500")} aria-hidden />
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
        aria-label="เมนูทางลัด"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {PRIMARY.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            return (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors",
                    "active:bg-zinc-100",
                    active ? "text-emerald-700" : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  <Icon className={cn("h-6 w-6", active ? "text-emerald-600" : "text-zinc-500")} aria-hidden />
                  <span className="leading-tight">{item.label}</span>
                </Link>
              </li>
            );
          })}
          {/* เพิ่มเติม — opens overflow sheet */}
          <li className="flex">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              className={cn(
                "relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors",
                "active:bg-zinc-100",
                overflowActive ? "text-emerald-700" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              <MoreHorizontal
                className={cn("h-6 w-6", overflowActive ? "text-emerald-600" : "text-zinc-500")}
                aria-hidden
              />
              <span className="leading-tight">เพิ่มเติม</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
