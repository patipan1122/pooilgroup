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
import { usePathname, useRouter } from "next/navigation";
import {
  Banknote,
  Sparkles,
  UserCircle2,
  Wallet,
  Wrench,
  Package,
  ArrowLeftCircle,
  MapPin,
  ChevronDown,
  Check,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setActiveBranch } from "../actions";

type MaidBranch = { id: string; name: string };

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

function ReturnToSelfBar({ adminName }: { adminName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function returnToSelf() {
    startTransition(async () => {
      await fetch("/api/admin/users/return-to-self", { method: "POST" });
      router.push("/chairops/users");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 border-b-2 border-amber-600 bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-900">
      <span className="truncate">
        🎭 เล่นเป็นแม่บ้าน · บัญชีจริง: {adminName}
      </span>
      <button
        onClick={returnToSelf}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white active:bg-zinc-700 disabled:opacity-60"
      >
        <ArrowLeftCircle className="size-3.5" aria-hidden />
        {pending ? "กำลังกลับ..." : "กลับเป็นตัวเอง"}
      </button>
    </div>
  );
}

// Branch switcher (multi-branch · CEO 2026-07-08). Sits under the header so the
// ACTIVE branch is visible on every page. Hidden entirely for the 90% single-
// branch case; a plain label for it would just add noise.
function BranchSwitcher({
  branches,
  activeBranchId,
  activeBranchName,
}: {
  branches: MaidBranch[];
  activeBranchId: string | null;
  activeBranchName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (branches.length <= 1) return null; // single-branch maid → no switcher

  function pick(id: string) {
    if (id === activeBranchId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await setActiveBranch(id);
      setOpen(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("สลับสาขาแล้ว");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="flex w-full items-center gap-1.5 bg-emerald-700/40 px-4 py-1.5 text-left text-xs font-semibold text-white active:bg-emerald-700/60 disabled:opacity-70"
        aria-haspopup="dialog"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <MapPin className="size-4 shrink-0" aria-hidden />
        )}
        <span className="truncate">
          กำลังทำงานที่ · {activeBranchName ?? "เลือกสาขา"}
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="เลือกสาขา"
        >
          <div
            className="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300" />
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">
              เลือกสาขาที่กำลังทำงาน
            </h2>
            <ul className="space-y-1">
              {branches.map((b) => {
                const isActive = b.id === activeBranchId;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => pick(b.id)}
                      disabled={pending}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium active:bg-zinc-100 disabled:opacity-60",
                        isActive
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : "border-zinc-200 text-zinc-800",
                      )}
                    >
                      <MapPin className="size-4 shrink-0 text-zinc-400" aria-hidden />
                      <span className="min-w-0 grow truncate">{b.name}</span>
                      {isActive && (
                        <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export function MaidShell({
  displayName,
  pendingDepositCount = 0,
  actingAsAdminName,
  branches = [],
  activeBranchId = null,
  activeBranchName = null,
  children,
}: {
  displayName: string;
  pendingDepositCount?: number;
  /** Set when a super_admin is impersonating this maid. Shows return-to-self bar. */
  actingAsAdminName?: string | null;
  /** Branches the maid manages (multi-branch). Switcher shows only when >1. */
  branches?: MaidBranch[];
  activeBranchId?: string | null;
  activeBranchName?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/chairops/m";

  return (
    <div className="min-h-screen bg-zinc-50 pb-[calc(64px+env(safe-area-inset-bottom))]">
      {actingAsAdminName && <ReturnToSelfBar adminName={actingAsAdminName} />}
      <header
        className="sticky top-0 z-30 border-b border-emerald-700 bg-emerald-600 text-white"
        // Green ChairOps banner per mockup · no backdrop-blur (old Chrome safe)
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <Link
            href="/chairops/m"
            className="flex items-center gap-2 text-base font-bold tracking-tight text-white"
            aria-label="หน้าหลัก ChairOps"
          >
            {/* โลโก้นวดน้า — แบรนด์ในหัวแอป */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/nuad-logo-128.png"
              alt=""
              aria-hidden
              className="size-10 rounded-full bg-white/95 ring-1 ring-white/50"
            />
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
        <BranchSwitcher
          branches={branches}
          activeBranchId={activeBranchId}
          activeBranchName={activeBranchName}
        />
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
