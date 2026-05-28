"use client";

// Office top-nav · the only client island in the (office) shell.
// usePathname() is the cheapest way to drive active-state highlighting;
// keeping it isolated leaves the rest of the layout server-rendered.
//
// Items shown per role:
//   - OFFICE+: หน้าหลัก · Reconcile · POS · Alerts · Write-offs
//   - MANAGER+: + Users (admin section · per nav plan §5.1)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { ChairopsUserRole } from "@/lib/generated/prisma/enums";

interface NavItem {
  href: string;
  label: string;
  /** Minimum rank to display. */
  min?: ChairopsUserRole;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/chairops", label: "หน้าหลัก" },
  { href: "/chairops/reconcile", label: "ตรวจยอด" },
  { href: "/chairops/pos-ingest", label: "POS" },
  { href: "/chairops/alerts", label: "Alerts" },
  { href: "/chairops/write-offs", label: "ตัดเงินขาด" },
  { href: "/chairops/users", label: "ผู้ใช้", min: "MANAGER" },
];

const ROLE_RANK: Record<ChairopsUserRole, number> = {
  MAID: 1,
  TECHNICIAN: 1,
  OFFICE: 2,
  MANAGER: 3,
  CEO: 4,
  ADMIN: 5,
};

function canSee(actor: ChairopsUserRole, min?: ChairopsUserRole): boolean {
  if (!min) return true;
  return ROLE_RANK[actor] >= ROLE_RANK[min];
}

export function OfficeTopNav({ role }: { role: ChairopsUserRole }) {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-1 items-center gap-1 overflow-x-auto text-sm"
      aria-label="เมนูออฟฟิศ"
    >
      {NAV_ITEMS.filter((item) => canSee(role, item.min)).map((item) => {
        // Home = exact match · others = prefix match
        const isActive =
          item.href === "/chairops"
            ? pathname === "/chairops"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
