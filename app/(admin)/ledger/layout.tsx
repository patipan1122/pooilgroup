// Ledger (ระบบบัญชี / LedgerLine) module layout — gates the whole /ledger/** tree.
//
// Gate stack (same pattern as cashhub/chairops):
//   1. Kill switch (MODULES_DISABLED env) — handled inside assertModuleEnabled
//   2. Pool session required
//   3. Module entitlement (user_modules grant or admin tier)
//
// Role-level access (who can see budgets/settings) is enforced per nav item in
// lib/modules.ts and per page where needed. The company/branch picker lives in
// each page header (LedgerHeader) because Next layouts don't receive
// searchParams — the picker is URL-driven (?company=&branch=).

import { Suspense } from "react";
import { assertModuleEnabled } from "@/lib/auth/module-access";
import { getSession } from "@/lib/auth/session";
import { LedgerBottomNav } from "@/components/ledger/LedgerBottomNav";

export const dynamic = "force-dynamic";

export const metadata = { title: "LedgerLine บัญชี" };

export default async function LedgerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("ledger");
  // getSession() is React cache()-wrapped → shared with child pages, no extra
  // round-trip. Drives the role-filtered mobile bottom nav.
  const session = await getSession();

  return (
    // pb spacer keeps content clear of the fixed mobile bar; desktop (lg) uses
    // the Pool sidebar so no bottom bar + no spacer.
    <div className="ledger-scope pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
      {children}
      {/* Suspense: LedgerBottomNav reads useSearchParams (?selected collision guard). */}
      {session ? (
        <Suspense fallback={null}>
          <LedgerBottomNav role={session.user.role} />
        </Suspense>
      ) : null}
    </div>
  );
}
