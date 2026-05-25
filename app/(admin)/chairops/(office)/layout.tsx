// Office route-group shell (W1 · claude-design Phase 2)
// Spec: /tmp/claude-design_chairops_plan.md §1.1 + §5.1 + §W1
//
// Wraps every (office) page in:
//   1. OFFICE+ role gate (defense-in-depth on top of chairops/layout.tsx
//      entitlement gate per [[module-entitlement-must-gate-all-layouts]])
//   2. `.chairops-scope` CSS namespace so kit primitives pick up ChairOps tokens
//   3. Solid sticky top-nav with 5-6 office sections (Home · Reconcile · POS ·
//      Alerts · Write-offs · Users) — solid bg per [[sticky-bg-inherit-anti-pattern]]
//
// Pages MAY (and do) keep their own `<div className="chairops-scope">` wrappers
// as a defensive pattern — duplicate classes are harmless · the layout adds it
// at the root so future pages don't have to repeat themselves.
//
// Active-state highlighting uses Next.js usePathname() in the client nav island
// (top-nav is the only client subtree; the rest of the layout is server).

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeTopNav } from "./_components/office-top-nav";

export const dynamic = "force-dynamic";

export default async function OfficeShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("OFFICE");

  return (
    <div className="chairops-scope min-h-screen bg-muted/40">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/chairops"
            className="text-sm font-bold tracking-tight text-foreground"
            title="ChairOps · หน้าหลัก"
          >
            ChairOps
            <span className="ml-1.5 hidden text-xs font-normal text-muted-foreground sm:inline">
              · ออฟฟิศ
            </span>
          </Link>
          <OfficeTopNav role={session.user.role} />
          <div className="ml-auto hidden text-right text-xs text-muted-foreground sm:block">
            <div className="font-medium text-foreground">
              {session.user.displayName}
            </div>
            <div>{session.user.role}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
