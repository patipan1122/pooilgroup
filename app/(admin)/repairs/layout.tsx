import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";

export const dynamic = "force-dynamic";

export default async function RepairsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  return <div className="min-h-screen bg-zinc-50/30">{children}</div>;
}
