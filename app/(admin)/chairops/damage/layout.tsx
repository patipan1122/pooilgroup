// /damage layout — wraps admin pages in AdminShell, but lets MAID through bare
// (because /damage/new is maid-scope, built by another agent)
import { requireAuth } from "@/lib/chairops/auth/session";
import { AdminShell } from "@/components/chairops/features/admin-shell";

export default async function DamageLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  if (session.user.role === "MAID") {
    // maid sees /damage/new without admin chrome
    return <>{children}</>;
  }
  return <AdminShell session={session}>{children}</AdminShell>;
}
