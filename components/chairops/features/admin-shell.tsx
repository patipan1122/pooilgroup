// Shared admin shell · top nav · role-aware
// Used by /damage, /parts, /users, /audit, /accounts layouts.
// Mirrors dashboard/layout.tsx style.
import Link from "next/link";
import type { Session } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";

const NAV: { href: string; label: string; minRole?: "OFFICE" | "MANAGER" | "ADMIN" | "CEO" }[] = [
  { href: "/chairops/dashboard", label: "สรุป", minRole: "MANAGER" },
  { href: "/chairops/dashboard/all-branches", label: "สาขา", minRole: "MANAGER" },
  { href: "/chairops/cleanliness", label: "ความสะอาด", minRole: "MANAGER" },
  { href: "/chairops/damage", label: "ของเสีย" },
  { href: "/chairops/parts", label: "อะไหล่", minRole: "OFFICE" },
  { href: "/chairops/accounts", label: "บัญชี", minRole: "OFFICE" },
  { href: "/chairops/reports", label: "รายงาน", minRole: "MANAGER" },
  { href: "/chairops/users", label: "ผู้ใช้", minRole: "ADMIN" },
  { href: "/chairops/audit", label: "Audit", minRole: "CEO" },
];

export function AdminShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const items = NAV.filter(
    (n) => !n.minRole || rankOf(session.user.role) >= rankOf(n.minRole)
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:h-16 sm:px-6">
          <Link href="/chairops/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="text-lg sm:text-xl">ChairOps</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 overflow-x-auto sm:gap-2">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3 sm:py-2"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            <div className="font-medium text-foreground">{session.user.displayName}</div>
            <div>{session.user.role}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
