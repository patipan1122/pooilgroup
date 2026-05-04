"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  Building2,
  ScrollText,
  Settings,
  Menu,
  X,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { browserClient } from "@/lib/db/client";
import { cn } from "@/lib/utils/cn";
import type { DbUser } from "@/lib/auth/session";

const NAV = [
  { href: "/dashboard", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/cashhub", label: "ยอดสาขา (CashHub)", icon: Wallet },
  { href: "/branches", label: "สาขา", icon: Building2 },
  { href: "/reports", label: "รายงานทั้งหมด", icon: ScrollText },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, adminOnly: true },
];

interface Props {
  user: DbUser;
  children: React.ReactNode;
}

export function AdminShell({ user, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const isAdmin = user.role === "super_admin" || user.role === "org_admin";
  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin);

  async function logout() {
    const sb = browserClient();
    await sb.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 h-14 sm:h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-zinc-100"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-[--color-brand-600] text-white flex items-center justify-center font-bold font-display text-sm shadow-soft">
              P
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold leading-tight font-display tracking-tight">
                Pool Group
              </div>
              <div className="text-[11px] text-zinc-500 leading-tight">
                Command Center
              </div>
            </div>
          </Link>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl hover:bg-zinc-100 px-2 py-1.5 transition-colors"
          >
            <div className="size-8 rounded-full bg-[--color-brand-100] text-[--color-brand-700] flex items-center justify-center text-sm font-semibold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-medium leading-tight">
                {user.name}
              </div>
              <div className="text-[11px] text-zinc-500 leading-tight">
                {ROLE_LABELS[user.role]}
              </div>
            </div>
            <ChevronDown className="size-4 text-zinc-400" />
          </button>
          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl border border-zinc-200 shadow-lg p-1 z-20">
                <div className="px-3 py-2 border-b border-zinc-100">
                  <div className="text-sm font-medium truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {user.email ?? user.phone ?? "—"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 rounded-lg"
                >
                  <LogOut className="size-4" />
                  ออกจากระบบ
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <nav className="flex-1 p-3 space-y-0.5">
            {visibleNav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    active
                      ? "bg-[--color-brand-50] text-[--color-brand-700]"
                      : "text-zinc-700 hover:bg-zinc-100",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-3 border-t border-zinc-100">
            <div className="text-[11px] text-zinc-400 px-3">
              v0.1 · Sprint 0
            </div>
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-zinc-950/40"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl flex flex-col">
              <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-200">
                <span className="font-semibold font-display">Pool Group</span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 -mr-2 rounded-lg hover:bg-zinc-100"
                  aria-label="Close menu"
                >
                  <X className="size-5" />
                </button>
              </div>
              <nav className="flex-1 p-3 space-y-0.5 overflow-auto">
                {visibleNav.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium",
                        active
                          ? "bg-[--color-brand-50] text-[--color-brand-700]"
                          : "text-zinc-700 hover:bg-zinc-100",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<DbUser["role"], string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "ผู้จัดการสาขา",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};
