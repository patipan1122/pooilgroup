// Office area shell — top nav (POS · Reconcile · Write-off · Alerts · กลับ Dashboard)
// Per spec: `requireRole("OFFICE")` runs here AND every Office page also enforces
// (defense-in-depth — layouts don't always re-run for streamed nested pages).
//
// Exports `OfficeShell` so sibling areas (pos-ingest / reconcile / write-offs / alerts)
// can wrap their pages in the same chrome.
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import type { Session } from "@/lib/chairops/auth/session";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/chairops/pos-ingest", label: "POS รายวัน" },
  { href: "/chairops/reconcile", label: "ตรวจยอด" },
  { href: "/chairops/write-offs", label: "ตัดเงินขาด" },
  { href: "/chairops/alerts", label: "Alerts" },
];

export function OfficeShell({
  session,
  active,
  children,
}: {
  session: Session;
  active?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-1 px-4 sm:px-6">
          <Link
            href="/chairops/dashboard"
            className="mr-4 text-sm font-bold tracking-tight text-foreground"
            title="กลับหน้า Dashboard"
          >
            ChairOps · ออฟฟิศ
          </Link>
          <nav className="flex flex-1 items-center gap-1 text-sm">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "rounded-md px-3 py-1.5 font-medium transition-colors " +
                    (isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">
              {session.user.displayName} · {session.user.role}
            </span>
            <Link
              href="/chairops/dashboard"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              กลับ Dashboard
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export default async function DashboardOfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("OFFICE");
  return (
    <OfficeShell session={session} active="/chairops/dashboard-office">
      {children}
    </OfficeShell>
  );
}
