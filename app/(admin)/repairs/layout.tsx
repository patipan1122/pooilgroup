import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import "./repairs.css";

export const dynamic = "force-dynamic";

export default async function RepairsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("repairs")) redirect("/dashboard");
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "repairs");
    if (!ok) redirect("/403");
  }
  return <div className="repair-root repair-shell">{children}</div>;
}
