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

import { assertModuleEnabled } from "@/lib/auth/module-access";

export const dynamic = "force-dynamic";

export default async function LedgerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("ledger");
  return <div className="ledger-scope">{children}</div>;
}
