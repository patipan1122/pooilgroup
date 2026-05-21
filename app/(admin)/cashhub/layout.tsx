// Layout guard for /cashhub/** routes — blocks users who don't have CashHub
// in their user_modules grants. Admin tier (super/org_admin/admin) bypasses.
//
// Why a layout.tsx and not per-page checks: every sub-route of CashHub
// shares the same access requirement. Centralising here means each new
// /cashhub/* page automatically inherits the guard.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { ApprovalBanner } from "@/components/cashhub/redesign/approval-banner";
import "@/components/cashhub/redesign/tokens.css";

export default async function CashHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill switch (MODULES_DISABLED env) takes precedence over per-user grants —
  // even super_admin gets bounced when ops flips the module off.
  if (isModuleDisabled("cashhub")) redirect("/dashboard");

  const session = await requireSession();
  // Fast path — admin tier always has access; skip the DB query.
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "cashhub");
    if (!ok) redirect("/403");
  }
  // .ch-scope owns the design-token CSS vars — every CashHub page reads them.
  // ApprovalBanner queries pending counts on each render (server component).
  return (
    <div className="ch-scope">
      <ApprovalBanner orgId={session.user.org_id} />
      {children}
    </div>
  );
}
