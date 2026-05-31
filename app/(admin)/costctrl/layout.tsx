// CostCtrl layout — super_admin ONLY (CEO).
// Even org_admin / admin are redirected.
// BIGFEATURE 2026-05-31 · spec docs/BIGFEATURE_costctrl_SPEC.md

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { isModuleDisabled } from "@/lib/modules";

export default async function CostCtrlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("costctrl")) redirect("/dashboard");
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  return <div className="cc-scope">{children}</div>;
}
