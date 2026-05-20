import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { RecruitChatFab } from "@/components/recruit/chat-fab";

export const dynamic = "force-dynamic";

export default async function RecruitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  return (
    <div className="relative min-h-screen bg-zinc-50/30">
      {children}
      {/* AI chat FAB · CEO-confirmed manual trigger only */}
      <RecruitChatFab />
    </div>
  );
}
