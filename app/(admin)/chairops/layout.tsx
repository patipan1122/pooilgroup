// ChairOps module layout — gates entire /chairops/** subtree.
//
// Gate stack (per memory module-entitlement-must-gate-all-layouts):
//   1. Kill switch (MODULES_DISABLED env)
//   2. Pool session required
//   3. Module entitlement (user_modules grant or admin tier)
//
// Role-level access (ADMIN/MANAGER/OFFICE/MAID/TECH) is enforced separately
// inside each ChairOps page via `requireRole()` / `requireExactRole()` from
// `lib/chairops/auth/session.ts`. This layout only blocks users who have no
// business in the module at all.

import "@/components/chairops/redesign/tokens.css";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";

export const dynamic = "force-dynamic";

export default async function ChairOpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("chairops")) redirect("/dashboard");
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "chairops");
    if (!ok) redirect("/403");
  }
  return <div className="co-scope">{children}</div>;
}
