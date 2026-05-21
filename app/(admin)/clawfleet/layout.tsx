import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { CF_ALL_ROLES } from "@/lib/clawfleet/role-guard";

export const dynamic = "force-dynamic";

export default async function ClawfleetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("clawfleet")) redirect("/dashboard");
  const session = await requireSession();
  if (!(CF_ALL_ROLES as readonly string[]).includes(session.user.role)) {
    redirect("/403");
  }
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "clawfleet");
    if (!ok) redirect("/403");
  }
  return <div className="min-h-screen bg-zinc-50/30">{children}</div>;
}
