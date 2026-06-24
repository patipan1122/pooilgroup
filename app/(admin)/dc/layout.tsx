// DC Warehouse module layout — gates entire /dc/** subtree.
//
// Gate stack (per [[module-entitlement-must-gate-all-layouts]]):
//   1. Kill switch (MODULES_DISABLED env)
//   2. Session required
//   3. Role minimum (DC_ROLES)
//   4. Module entitlement (user_modules grant or admin tier)

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { requireDcAccess, canDcManage } from "@/lib/dc/role-guard";
import { DcMobileNav } from "@/components/dc/mobile-bottom-nav";
import "./dc.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "DC คลังกลาง" };

export default async function DcLayout({ children }: { children: React.ReactNode }) {
  if (isModuleDisabled("dc")) redirect("/dashboard");
  const session = await requireSession();
  requireDcAccess(session.user.role);
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "dc");
    if (!ok) redirect("/403");
  }
  return (
    <div className="dc-root dc-has-mobilenav">
      {children}
      <DcMobileNav canManage={canDcManage(session.user.role)} />
    </div>
  );
}
