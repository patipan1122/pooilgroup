// RentSpaceBottomNav · mobile bottom-navigation for the RentSpace web surface.
//
// RentSpace (บริหารพื้นที่เช่า) previously had NO bottom shortcut bar on the web —
// only the Pool admin sidebar (hamburger on mobile). CEO 2026-06-24 asked for a
// proper mobile version with a bottom menu so every feature is one thumb-tap
// away on a phone (property managers work on-site walking the plaza).
//
// Pattern adapted 1:1 from components/ledger/LedgerBottomNav.tsx (route-based,
// usePathname, overflow sheet, safe-area, NO backdrop-blur for old webviews) but:
//   • RentSpace BRAND tokens (--rs-brand active) instead of ledger brand
//   • a raised CENTER FAB → "จดมิเตอร์" (the recurring monthly field task done on
//     a phone, walking unit-to-unit — the heart of the rent cycle)
//   • role-FILTERED cells: a cell the user can't reach is HIDDEN, never rendered
//     as a dead/403 tab (mirrors lib/modules.ts rentspace nav role gates:
//     import + settings = admin-tier only; everything else = all module roles)
//   • shows ONLY on mobile (`lg:hidden`) so desktop keeps the sidebar untouched
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Gauge,
  Receipt,
  MoreHorizontal,
  Table2,
  Users,
  ScrollText,
  Banknote,
  Wallet2,
  HandCoins,
  BarChart3,
  Upload,
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
  /** Exact-match only (home tab — every route starts with /rentspace). */
  exact?: boolean;
  /** Roles allowed to see this cell. Omit = everyone in the module. */
  roles?: ReadonlyArray<Role>;
  /** Section header inside the "เพิ่มเติม" sheet (grouped for easy scanning). */
  group?: string;
}

// Admin tier — kept in sync with lib/modules.ts rentspace nav gates
// (import: roles super/org/admin · settings: adminOnly). program_admin acts as
// a full admin inside a granted module (admin-shell moduleNav rule) so it's in.
const ADMIN: ReadonlyArray<Role> = ["super_admin", "org_admin", "admin", "program_admin"];

// Primary thumb-reach cells. The recurring rent cycle is จดมิเตอร์ → ออกบิล →
// รับชำระ, so the center FAB = จดมิเตอร์ (the on-site phone task), บิล on the right.
const LEFT: ReadonlyArray<NavItem> = [
  { href: "/rentspace", label: "ภาพรวม", icon: LayoutDashboard, match: "/rentspace", exact: true },
  { href: "/rentspace/units", label: "ห้อง", icon: Building2, match: "/rentspace/units" },
];
const RIGHT: ReadonlyArray<NavItem> = [
  { href: "/rentspace/bills", label: "บิล", icon: Receipt, match: "/rentspace/bills" },
];
// "เพิ่มเติม" overflow sheet — grouped by job for easy scanning (mirrors sidebar sections).
const OVERFLOW: ReadonlyArray<NavItem> = [
  { href: "/rentspace/matrix", label: "ตารางค่าเช่า", icon: Table2, match: "/rentspace/matrix", group: "โครงการ" },
  { href: "/rentspace/tenants", label: "ผู้เช่า", icon: Users, match: "/rentspace/tenants", group: "โครงการ" },
  { href: "/rentspace/contracts", label: "สัญญาเช่า", icon: ScrollText, match: "/rentspace/contracts", group: "เอกสาร" },
  { href: "/rentspace/payments", label: "การชำระเงิน", icon: Banknote, match: "/rentspace/payments", group: "การเงิน" },
  { href: "/rentspace/collections", label: "ติดตามค้างชำระ", icon: HandCoins, match: "/rentspace/collections", group: "การเงิน" },
  { href: "/rentspace/deposits", label: "เงินประกัน", icon: Wallet2, match: "/rentspace/deposits", group: "การเงิน" },
  { href: "/rentspace/analytics", label: "วิเคราะห์", icon: BarChart3, match: "/rentspace/analytics", group: "การเงิน" },
  { href: "/rentspace/import", label: "นำเข้าข้อมูล", icon: Upload, match: "/rentspace/import", roles: ADMIN, group: "จัดการ" },
  { href: "/rentspace/settings", label: "ตั้งค่าโครงการ", icon: Settings, match: "/rentspace/settings", roles: ADMIN, group: "จัดการ" },
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
      )}
      style={{ color: active ? "var(--rs-brand)" : "var(--rs-text-3)" }}
    >
      {active && (
        <span
          className="absolute inset-x-3 top-0 h-0.5 rounded-full"
          style={{ background: "var(--rs-brand)" }}
          aria-hidden
        />
      )}
      <Icon className="h-6 w-6" aria-hidden />
      <span className="leading-tight">{item.label}</span>
    </Link>
  );
}

export function RentSpaceBottomNav({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/rentspace";
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Collision guard — hide on the public sign / print surfaces (those are their
  // own full-screen flows). The unit-drawer is a z-50 modal that covers the nav,
  // so no guard needed there. `?unit=` drawer also fine (modal on top).
  if (pathname.startsWith("/rentspace/bills/print")) return null;

  const left = visible(LEFT, role);
  const right = visible(RIGHT, role);
  const overflow = visible(OVERFLOW, role);
  const onMeters = pathname.startsWith("/rentspace/meters");
  const overflowActive = overflow.some((o) => isActive(pathname, o));

  // Hidden flag kept for parity with searchParams usage (deep-link friendliness).
  void searchParams;

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
            className="animate-fade-in absolute inset-0 bg-black/40"
          />
          <div
            className="animate-slide-up-soft absolute inset-x-0 bottom-0 rounded-t-2xl border-t bg-white p-4"
            style={{
              borderColor: "var(--rs-border)",
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold" style={{ color: "var(--rs-text)" }}>
                เมนูเพิ่มเติม
              </h2>
              <button
                type="button"
                aria-label="ปิด"
                onClick={() => setSheetOpen(false)}
                className="grid size-11 place-items-center rounded-full text-zinc-500 active:bg-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="space-y-4">
              {[...new Set(overflow.map((o) => o.group ?? "อื่น ๆ"))].map((g) => (
                <div key={g}>
                  <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }}>
                    {g}
                  </h3>
                  <ul className="grid grid-cols-3 gap-2">
                    {overflow
                      .filter((o) => (o.group ?? "อื่น ๆ") === g)
                      .map((item) => {
                        const Icon = item.icon;
                        const active = isActive(pathname, item);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setSheetOpen(false)}
                              aria-current={active ? "page" : undefined}
                              className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-center text-[11px] font-medium transition-colors active:bg-zinc-100"
                              style={
                                active
                                  ? {
                                      borderColor: "var(--rs-brand)",
                                      background: "var(--rs-brand-50)",
                                      color: "var(--rs-brand-700)",
                                    }
                                  : { borderColor: "var(--rs-border)", background: "#fff", color: "var(--rs-text-2)" }
                              }
                            >
                              <Icon
                                className="h-6 w-6"
                                style={{ color: active ? "var(--rs-brand)" : "var(--rs-text-3)" }}
                                aria-hidden
                              />
                              <span className="leading-tight">{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fixed bottom bar — mobile only */}
      <nav
        aria-label="เมนูทางลัด บริหารพื้นที่เช่า"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-white"
        style={{ borderColor: "var(--rs-border)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex h-16 max-w-md items-stretch">
          {/* left cells */}
          <div className="flex flex-1">
            {left.map((item) => (
              <Cell key={item.href} item={item} pathname={pathname} />
            ))}
          </div>

          {/* center raised FAB → จดมิเตอร์ (the recurring on-site phone task) */}
          <div className="flex w-16 flex-none flex-col items-center justify-start pt-1">
            <Link
              href="/rentspace/meters"
              aria-label="จดมิเตอร์"
              aria-current={onMeters ? "page" : undefined}
              className="grid size-14 -mt-5 place-items-center rounded-full text-white shadow-lg ring-4 ring-white transition-transform active:scale-95"
              style={{ background: "var(--rs-brand)" }}
            >
              <Gauge className="size-6" aria-hidden />
            </Link>
            <span
              className="mt-0.5 text-[11px] font-medium"
              style={{ color: onMeters ? "var(--rs-brand)" : "var(--rs-text-3)" }}
            >
              จดมิเตอร์
            </span>
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
                className="relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors active:bg-zinc-100"
                style={{ color: overflowActive ? "var(--rs-brand)" : "var(--rs-text-3)" }}
              >
                <MoreHorizontal className="h-6 w-6" aria-hidden />
                <span className="leading-tight">เพิ่มเติม</span>
              </button>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
