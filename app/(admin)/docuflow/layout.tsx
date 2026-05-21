// Layout guard for /docuflow/** routes — blocks users who don't have DocuFlow
// in their user_modules grants. Admin tier (super/org_admin/admin) bypasses.
//
// Also wraps children in `.df-root` so canvas-aligned design tokens from
// `./docuflow.css` apply across all /docuflow pages without polluting other
// modules.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import "./docuflow.css";

export const dynamic = "force-dynamic";

export default async function DocuFlowLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("docuflow")) redirect("/dashboard");
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "docuflow");
    if (!ok) redirect("/403");
  }
  return <div className="df-root">{children}</div>;
}
