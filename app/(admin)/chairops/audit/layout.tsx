import { requireRole } from "@/lib/chairops/auth/session";
import { AdminShell } from "@/components/chairops/features/admin-shell";

export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("CEO");
  return <AdminShell session={session}>{children}</AdminShell>;
}
