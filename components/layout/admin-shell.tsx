"use client";

import { useState, useMemo, useEffect, Fragment } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  X,
  ChevronDown,
  LogOut,
  Users as UsersIcon,
  ShieldCheck,
  Settings,
  UserCircle,
  Home,
  Check,
  Building2,
  Inbox,
  Bell,
  Lock,
  HardDrive,
  Bot,
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
} from "@/lib/modules";
import { NotificationBell } from "./notification-bell";
import { QuickApproveBar } from "./quick-approve-bar";
import { CompanySwitcher } from "./company-switcher";

// Lazy-mount AiChat: the floating launcher button below is plain HTML, so
// every admin route renders without paying for the 15-25 KB AiChat bundle.
// The chat module is only fetched after the user first clicks the button.
const AiChat = dynamic(
  () => import("@/components/cashhub/ai-chat").then((m) => ({ default: m.AiChat })),
  { ssr: false },
);

function AiChatLauncher() {
  const [mounted, setMounted] = useState(false);
  if (mounted) {
    return <AiChat defaultOpen />;
  }
  return (
    <button
      type="button"
      onClick={() => setMounted(true)}
      className="fixed bottom-4 right-4 z-30 size-11 rounded-xl shadow-blue flex items-center justify-center transition-transform hover:scale-105 bg-[var(--color-brand-600)] text-white"
      aria-label="ถาม AI"
      title="ถาม AI Assistant"
    >
      <Bot className="size-5" />
    </button>
  );
}

/** Sidebar nav-counts surfaced as red badges next to specific menu items.
    Loaded server-side in app/(admin)/layout.tsx via loadNavCounts(orgId). */
export interface NavCountsClient {
  pendingRegisterRequests: number;
  branchesMissingMgr: number;
  pendingCashReports: number;
}

interface SimpleNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional key to read a count from NavCountsClient and render a badge. */
  badgeKey?: keyof NavCountsClient;
  /** When true, render with extra left padding to nest under the parent above. */
  indent?: boolean;
}

const MANAGE_NAV: SimpleNavItem[] = [
  { href: "/users", label: "ทีม & สาขา", icon: UsersIcon, badgeKey: "branchesMissingMgr" },
  { href: "/companies", label: "บริษัท", icon: Building2 },
  { href: "/users/requests", label: "คำขอเข้าใช้งาน", icon: Inbox, badgeKey: "pendingRegisterRequests" },
];

const SYSTEM_NAV: SimpleNavItem[] = [
  { href: "/audit", label: "Audit Log", icon: ShieldCheck },
  { href: "/settings", label: "ตั้งค่าระบบ", icon: Settings },
  { href: "/settings/notifications", label: "แจ้งเตือน", icon: Bell, indent: true },
  { href: "/settings/security", label: "ความปลอดภัย", icon: Lock, indent: true },
  { href: "/settings/backup", label: "สำรองข้อมูล", icon: HardDrive, indent: true },
];

const ACCOUNT_NAV: SimpleNavItem[] = [
  { href: "/profile", label: "โปรไฟล์", icon: UserCircle },
];

interface Props {
  user: DbUser;
  children: React.ReactNode;
  companies?: Array<{ id: string; code: string; name: string }>;
  currentCompanyId?: string;
  navCounts?: NavCountsClient;
  /** Module slugs the current user can access. Admin tier always gets all
      three; everyone else gets the explicit set from user_modules. */
  userModules?: string[];
}

const ZERO_COUNTS: NavCountsClient = {
  pendingRegisterRequests: 0,
  branchesMissingMgr: 0,
  pendingCashReports: 0,
};

const ALL_MODULES = ["cashhub", "fuelos", "docuflow", "recruit"];

export function AdminShell({
  user,
  children,
  companies = [],
  currentCompanyId,
  navCounts = ZERO_COUNTS,
  userModules = ALL_MODULES,
}: Props) {
  const allowedModules = useMemo(() => new Set(userModules), [userModules]);
  const visibleModules = useMemo(
    () => MODULE_LIST.filter((m) => allowedModules.has(m.slug)),
    [allowedModules],
  );
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);

  const isAdmin =
    user.role === "super_admin" ||
    user.role === "org_admin" ||
    user.role === "admin";
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
    <div
      className="min-h-screen flex flex-col bg-zinc-50"
      data-module={activeModuleSlug ?? "home"}
    >
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
                      <p className="px-3 text-xs font-bold text-zinc-500 mb-1">
                        เปลี่ยนโปรแกรม
                      </p>
                      {visibleModules.map((m) => {
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
                              <span className="text-xs uppercase tracking-wide font-bold text-zinc-400">
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

      {/* Quick Approve Bar — sticky right under topnav. Only renders when there
          are pending items the current admin can act on. Hidden in 1 session
          via dismiss button. */}
      {isAdmin && (
        <QuickApproveBar
          pendingCashReports={navCounts.pendingCashReports ?? 0}
          pendingRegisterRequests={navCounts.pendingRegisterRequests ?? 0}
        />
      )}

      <div className="flex-1 flex">
        {/* Sidebar (desktop) — visible on EVERY admin page (including /home).
            4 zones: Home · Programs · Manage (admin) · System (admin) · Account.
            Module isolation: only the ACTIVE module shows its inner nav inline;
            other modules are collapsed to a single header row that links to
            the module landing. HARD RULE feedback_module_isolation.md.
            Collapsible state of each zone persists in localStorage. */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r-2 border-zinc-200 bg-white sticky top-14 sm:top-16 self-start max-h-[calc(100vh-3.5rem)] sm:max-h-[calc(100vh-4rem)] overflow-y-auto">
          <SidebarBody
            user={user}
            pathname={pathname}
            isAdmin={isAdmin}
            activeModuleSlug={activeModuleSlug}
            moduleNav={moduleNav}
            navCounts={navCounts}
          />
        </aside>

        {/* Mobile drawer — same content as desktop sidebar */}
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
              <div className="flex-1 overflow-auto">
                <SidebarBody
                  user={user}
                  pathname={pathname}
                  isAdmin={isAdmin}
                  activeModuleSlug={activeModuleSlug}
                  moduleNav={moduleNav}
                  navCounts={navCounts}
                  onNavigate={() => setMobileOpen(false)}
                />
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
          Lazy-mounted on first click via AiChatLauncher. */}
      <AiChatLauncher />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — 4 zones, collapsible groups, persists state per zone in localStorage.
// Module isolation HARD RULE: only the ACTIVE module shows its inner nav inline;
// other modules render as a single header row that links to the module landing.
// ─────────────────────────────────────────────────────────────────────────────

function SidebarBody({
  user,
  pathname,
  isAdmin,
  activeModuleSlug,
  moduleNav,
  navCounts,
  onNavigate,
}: {
  user: DbUser;
  pathname: string;
  isAdmin: boolean;
  activeModuleSlug: ModuleSlug | null;
  moduleNav: NavItem[];
  navCounts: NavCountsClient;
  onNavigate?: () => void;
}) {
  const activeModule = activeModuleSlug ? MODULES[activeModuleSlug] : null;
  return (
    <div className="py-3 flex flex-col">
      {/* Zone 1: Home */}
      <div className="px-3 mb-3">
        <SidebarLink
          href="/home"
          icon={Home}
          label="หน้าหลัก"
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      {/* Zone 2: Active module's inner nav (no module switcher here —
          switching modules is top-bar only per project rule
          feedback_module_switch_topbar_only.md). The header is just an
          informational label, not a clickable switcher. */}
      {activeModule && moduleNav.length > 0 && (
        <div className="px-3 mb-3">
          <p className="px-3 py-1 mb-1 text-xs font-bold text-zinc-500">
            {activeModule.emoji}{" "}
            <span className="text-[var(--color-brand-700)]">
              {activeModule.name}
            </span>
          </p>
          <div className="space-y-0.5">
            {moduleNav.map((it, i) => (
              <Fragment key={it.href}>
                {it.section && (
                  <p
                    className={`px-3 ${i === 0 ? "pt-0.5" : "pt-3"} pb-1 text-[10px] font-semibold text-zinc-400 tracking-wide uppercase`}
                  >
                    {it.section}
                  </p>
                )}
                <SidebarLink
                  href={it.href}
                  icon={it.icon}
                  label={it.label}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Zone 3: Manage (admin tier only) */}
      {isAdmin && (
        <SidebarSection title="จัดการ" storageKey="zone-manage">
          {MANAGE_NAV.map((it) => (
            <SidebarLink
              key={it.href}
              href={it.href}
              icon={it.icon}
              label={it.label}
              badgeCount={it.badgeKey ? navCounts[it.badgeKey] : undefined}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
      )}

      {/* Zone 4: System (admin tier only) */}
      {isAdmin && (
        <SidebarSection title="ระบบ" storageKey="zone-system">
          {SYSTEM_NAV.map((it) => (
            <SidebarLink
              key={it.href}
              href={it.href}
              icon={it.icon}
              label={it.label}
              badgeCount={it.badgeKey ? navCounts[it.badgeKey] : undefined}
              indent={it.indent}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
      )}

      {/* Bottom: account — separated by border */}
      <div className="mt-3 border-t-2 border-zinc-100 pt-3 px-3 space-y-0.5">
        {ACCOUNT_NAV.map((it) => (
          <SidebarLink
            key={it.href}
            href={it.href}
            icon={it.icon}
            label={it.label}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
        <p className="text-[10px] text-zinc-400 px-3 pt-2 truncate">
          เข้าใช้: <span className="font-bold text-zinc-600">{user.name}</span>
        </p>
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  storageKey,
  children,
}: {
  title: string;
  storageKey: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  // Hydrate from localStorage AFTER mount (cannot run during SSR). The
  // setState inside the effect is intentional — bridges localStorage
  // (external state) into React; cascading render is one-shot per mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`pooil_sidebar_${storageKey}`);
      if (saved === "0") setOpen(false);
      else if (saved === "1") setOpen(true);
    } catch {
      // localStorage unavailable — keep default
    }
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try {
        window.localStorage.setItem(
          `pooil_sidebar_${storageKey}`,
          next ? "1" : "0",
        );
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div className="px-3 mb-3">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-3 py-1 mb-1 hover:text-zinc-900 group"
      >
        <ChevronDown
          className={cn(
            "size-3 text-zinc-400 transition-transform group-hover:text-zinc-600",
            !open && "-rotate-90",
          )}
        />
        <span className="text-xs font-bold text-zinc-500">
          {title}
        </span>
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  label,
  pathname,
  onNavigate,
  indent,
  badgeCount,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  pathname: string;
  onNavigate?: () => void;
  /** When true, render with extra left padding to nest under a parent (e.g. module). */
  indent?: boolean;
  /** When > 0 a red pill is shown on the right (open items needing attention). */
  badgeCount?: number;
}) {
  // Indented (child) links: match exact only — they shouldn't claim deeper paths.
  // Non-indented (parent/standalone) links: match exact OR descendants — but we
  // also exclude /settings parent from claiming /settings/* (children handle those).
  const SETTINGS_CHILDREN = ["/settings/notifications", "/settings/security", "/settings/backup"];
  const active = indent
    ? pathname === href
    : href === "/settings"
    ? pathname === "/settings" ||
      (pathname.startsWith("/settings/") &&
        !SETTINGS_CHILDREN.some((c) => pathname === c || pathname.startsWith(c + "/")))
    : pathname === href ||
      (href !== "/home" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
        indent && "pl-9",
        active
          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]"
          : "text-zinc-700 hover:bg-zinc-100 border border-transparent",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-extrabold tabular-num shrink-0"
          aria-label={`${badgeCount} รายการต้องดู`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
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
  program_admin: "แอดมินโปรแกรม",
};
