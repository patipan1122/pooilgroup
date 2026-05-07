// Layout guard for /cashhub/** routes — blocks users who don't have CashHub
// in their user_modules grants. Admin tier (super/org_admin/admin) bypasses.
//
// Why a layout.tsx and not per-page checks: every sub-route of CashHub
// shares the same access requirement. Centralising here means each new
// /cashhub/* page automatically inherits the guard.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";

export default async function CashHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  // Fast path — admin tier always has access; skip the DB query.
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "cashhub");
    if (!ok) redirect("/403");
  }
  return <>{children}</>;
}
