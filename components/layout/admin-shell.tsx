"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  LogOut,
  Users as UsersIcon,
  ShieldCheck,
  Settings,
  UserCircle,
  Home,
  Check,
  Building2,
  Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { browserClient } from "@/lib/db/client";
import { cn } from "@/lib/utils/cn";
import type { DbUser } from "@/lib/auth/session";
import {
  MODULE_LIST,
  MODULES,
  getModuleFromPath,
  type ModuleSlug,
  type NavItem,
  type ModuleConfig,
} from "@/lib/modules";
import { NotificationBell } from "./notification-bell";
import { CompanySwitcher } from "./company-switcher";
const AiChat = dynamic(
  () => import("@/components/cashhub/ai-chat").then((m) => ({ default: m.AiChat })),
  { ssr: false },
);

interface SimpleNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const MANAGE_NAV: SimpleNavItem[] = [
  { href: "/users", label: "ทีม & สาขา", icon: UsersIcon },
  { href: "/companies", label: "บริษัท", icon: Building2 },
  { href: "/users/requests", label: "คำขอเข้าใช้งาน", icon: Inbox },
];

const SYSTEM_NAV: SimpleNavItem[] = [
  { href: "/audit", label: "Audit Log", icon: ShieldCheck },
  { href: "/settings", label: "ตั้งค่าระบบ", icon: Settings },
];

const ACCOUNT_NAV: SimpleNavItem[] = [
  { href: "/profile", label: "โปรไฟล์", icon: UserCircle },
];

interface Props {
  user: DbUser;
  children: React.ReactNode;
  companies?: Array<{ id: string; code: string; name: string }>;
  currentCompanyId?: string;
}

export function AdminShell({
  user,
  children,
  companies = [],
  currentCompanyId,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);

  const isAdmin = user.role === "super_admin" || user.role === "org_admin";
  const activeModuleSlug = getModuleFromPath(pathname);
  const activeModule = activeModuleSlug ? MODULES[activeModuleSlug] : null;
  const isHome = pathname === "/home" || pathname === "/";

  const moduleNav = useMemo(() => {
    if (!activeModule) return [];
    return activeModule.nav.filter((item) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.roles && !item.roles.includes(user.role)) return false;
      return true;
    });
  }, [activeModule, isAdmin, user.role]);

  async function logout() {
    // Hit our /api/auth/logout first so we audit + close session row
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    const sb = browserClient();
    await sb.auth.signOut().catch(() => {});
    router.refresh();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 h-14 sm:h-16 bg-white border-b-2 border-zinc-200 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-zinc-100"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/home" className="flex items-center gap-2.5 shrink-0">
            <div className="size-8 rounded-lg bg-[var(--color-brand-600)] text-white flex items-center justify-center font-bold font-display text-sm shadow-blue">
              P
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold leading-tight font-display tracking-tight">
                Pooilgroup
              </div>
              <div className="text-[11px] text-zinc-500 leading-tight">
                Command Center
              </div>
            </div>
          </Link>

          {/* Module switcher */}
          {!isHome && activeModule && (
            <>
              <div className="hidden sm:block h-8 w-px bg-zinc-200 ml-1" />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModuleMenuOpen((v) => !v)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-zinc-100 transition-colors min-w-0"
                >
                  <span className="text-xl">{activeModule.emoji}</span>
                  <div className="text-left hidden sm:block">
                    <div className="text-sm font-bold leading-tight">
                      {activeModule.name}
                    </div>
                    <div className="text-[10px] text-zinc-500 leading-tight">
                      {activeModule.tagline}
                    </div>
                  </div>
                  <ChevronDown className="size-4 text-zinc-400" />
                </button>
                {moduleMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setModuleMenuOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-2xl border-2 border-zinc-200 shadow-pop p-1.5 z-20">
                      <Link
                        href="/home"
                        onClick={() => setModuleMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-zinc-50 transition-colors mb-1"
                      >
                        <div className="size-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                          <Home className="size-4 text-zinc-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            กลับไปหน้าหลัก
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            ภาพรวมทุกโปรแกรม
                          </div>
                        </div>
                      </Link>
                      <div className="h-px bg-zinc-100 my-1.5" />
                      <p className="px-3 text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        เปลี่ยนโปรแกรม
                      </p>
                      {MODULE_LIST.map((m) => {
                        const isCurrent = m.slug === activeModule.slug;
                        const isComingSoon = m.status === "coming_soon";
                        const className = cn(
                          "flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors",
                          isCurrent && "bg-[var(--color-brand-50)]",
                          !isCurrent &&
                            !isComingSoon &&
                            "hover:bg-zinc-50 cursor-pointer",
                          isComingSoon &&
                            "opacity-60 cursor-not-allowed",
                        );
                        const inner = (
                          <>
                            <div className="size-9 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center text-lg">
                              {m.emoji}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold">
                                {m.name}
                              </div>
                              <div className="text-[11px] text-zinc-500 truncate">
                                {m.tagline}
                              </div>
                            </div>
                            {isCurrent && (
                              <Check className="size-4 text-[var(--color-brand-600)]" />
                            )}
                            {isComingSoon && (
                              <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                                Soon
                              </span>
                            )}
                          </>
                        );
                        if (isComingSoon || isCurrent) {
                          return (
                            <div key={m.slug} className={className}>
                              {inner}
                            </div>
                          );
                        }
                        return (
                          <Link
                            key={m.slug}
                            href={m.basePath}
                            onClick={() => setModuleMenuOpen(false)}
                            className={className}
                          >
                            {inner}
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Company switcher — global filter, visible in any module + on home */}
          {companies.length >= 2 && (
            <>
              <div className="hidden sm:block h-8 w-px bg-zinc-200 ml-1" />
              <CompanySwitcher
                companies={companies}
                currentCompanyId={currentCompanyId}
              />
            </>
          )}
        </div>

        {/* Right side: Bell + User */}
        <div className="flex items-center gap-1 shrink-0">
          <NotificationBell />

        {/* User dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl hover:bg-zinc-100 px-2 py-1.5 transition-colors"
          >
            <div className="size-8 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center text-sm font-bold border-2 border-[var(--color-brand-200)]">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-semibold leading-tight">
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
              <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl border-2 border-zinc-200 shadow-pop p-1.5 z-20">
                <div className="px-3 py-2.5 border-b border-zinc-100 mb-1">
                  <div className="text-sm font-semibold truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {user.email ?? user.phone ?? "—"}
                  </div>
                </div>
                <Link
                  href="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 rounded-xl"
                >
                  <UserCircle className="size-4" />
                  โปรไฟล์
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 rounded-xl"
                >
                  <LogOut className="size-4" />
                  ออกจากระบบ
                </button>
              </div>
            </>
          )}
        </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar (desktop) — module-isolated:
            - inside a module: ONLY that module's nav + back-to-home button
            - on core pages (/users etc): admin nav + account nav
            HARD RULE feedback_module_isolation.md — โปรแกรมใครโปรแกรมมัน */}
        {!isHome && (
          <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r-2 border-zinc-200 bg-white">
            <div className="flex-1 py-3 space-y-3">
              {activeModule && moduleNav.length > 0 ? (
                <NavGroup
                  title={activeModule.name.toUpperCase()}
                  items={moduleNav}
                  pathname={pathname}
                />
              ) : (
                <>
                  {isAdmin && (
                    <>
                      <NavGroup
                        title="จัดการ"
                        items={MANAGE_NAV}
                        pathname={pathname}
                      />
                      <NavGroup
                        title="ระบบ"
                        items={SYSTEM_NAV}
                        pathname={pathname}
                      />
                    </>
                  )}
                  <NavGroup
                    title="บัญชี"
                    items={ACCOUNT_NAV}
                    pathname={pathname}
                  />
                </>
              )}
            </div>
            <div className="px-3 py-3 border-t-2 border-zinc-100 bg-zinc-50/40">
              <Link
                href="/home"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-zinc-700 hover:text-[var(--color-brand-700)] hover:bg-white border-2 border-transparent hover:border-[var(--color-brand-200)] transition-all"
              >
                <Home className="size-4 shrink-0" />
                <span>กลับหน้าหลัก</span>
              </Link>
            </div>
          </aside>
        )}

        {/* Mobile drawer — same isolation rule as desktop */}
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-zinc-950/40"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-80 bg-white shadow-xl flex flex-col">
              <div className="h-14 px-4 flex items-center justify-between border-b-2 border-zinc-200">
                <span className="font-bold font-display">Pooilgroup</span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 -mr-2 rounded-lg hover:bg-zinc-100"
                  aria-label="Close menu"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 py-3 space-y-3 overflow-auto">
                {activeModule && moduleNav.length > 0 ? (
                  <NavGroup
                    title={activeModule.name.toUpperCase()}
                    items={moduleNav}
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ) : (
                  <>
                    {isAdmin && (
                      <>
                        <NavGroup
                          title="จัดการ"
                          items={MANAGE_NAV}
                          pathname={pathname}
                          onNavigate={() => setMobileOpen(false)}
                        />
                        <NavGroup
                          title="ระบบ"
                          items={SYSTEM_NAV}
                          pathname={pathname}
                          onNavigate={() => setMobileOpen(false)}
                        />
                      </>
                    )}
                    <NavGroup
                      title="บัญชี"
                      items={ACCOUNT_NAV}
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </>
                )}
              </div>
              <div className="px-3 py-3 border-t-2 border-zinc-100 bg-zinc-50/40">
                <Link
                  href="/home"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-zinc-700 hover:text-[var(--color-brand-700)] hover:bg-white border-2 border-transparent hover:border-[var(--color-brand-200)] transition-all"
                >
                  <Home className="size-4 shrink-0" />
                  <span>กลับหน้าหลัก</span>
                </Link>
              </div>
            </aside>
          </div>
        )}

        {/* Content — pb-20 leaves room below content so the floating AI
            button doesn't cover the last row / row-action menus */}
        <main className="flex-1 min-w-0 pb-20">{children}</main>
      </div>

      {/* Global floating AI Assistant — available to every signed-in user
          (admins for analysis, branch managers for how-to + their own data).
          The chat sends current pathname so it can answer page-specific questions. */}
      <AiChat />
    </div>
  );
}

function NavGroup({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: { href: string; label: string; icon: typeof Home }[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="px-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold px-3 mb-1.5">
        {title}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/home" && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
                active
                  ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]"
                  : "text-zinc-700 hover:bg-zinc-100 border border-transparent",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<DbUser["role"], string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  org_admin: "Admin",
  area_manager: "ผู้จัดการเขต",
  branch_manager: "ผู้จัดการสาขา",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};
