import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { userHasModuleAccess, isAdminTier } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";
import { RecruitChatFab } from "@/components/recruit/chat-fab";

export const dynamic = "force-dynamic";

export default async function RecruitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("recruit")) redirect("/dashboard");
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "recruit");
    if (!ok) redirect("/403");
  }

  return (
    <div className="relative min-h-screen bg-zinc-50/30">
      {children}
      {/* AI chat FAB · CEO-confirmed manual trigger only */}
      <RecruitChatFab />
    </div>
  );
}
