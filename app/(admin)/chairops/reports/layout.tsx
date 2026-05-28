// Reports layout — same chrome as dashboard (top nav · MANAGER gate)
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";

const NAV = [
  { href: "/chairops/dashboard", label: "สรุป" },
  { href: "/chairops/dashboard/all-branches", label: "สาขา" },
  { href: "/chairops/cleanliness", label: "ความสะอาด" },
  { href: "/chairops/damage", label: "ของเสีย" },
  { href: "/chairops/reports", label: "รายงาน" },
  { href: "/settings", label: "ตั้งค่า" },
];

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("MANAGER");
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:h-16 sm:px-6">
          <Link href="/chairops/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="text-lg sm:text-xl">ChairOps</span>
            <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
              · รายงาน
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 overflow-x-auto sm:gap-2">
            {NAV.map((item) => (
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
