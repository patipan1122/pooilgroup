import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { CF_ALL_ROLES } from "@/lib/clawfleet/role-guard";
import { MobileBottomNav } from "@/components/clawfleet/_kit/mobile-bottom-nav";

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
  const isAdmin = isAdminTier(session.user.role);
  return (
    <div className="min-h-screen bg-zinc-50/30">
      {/* Add bottom padding on mobile so content not hidden behind MobileBottomNav (64px + safe-area) */}
      <div className="pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </div>
      <MobileBottomNav isAdmin={isAdmin} />
    </div>
  );
}
