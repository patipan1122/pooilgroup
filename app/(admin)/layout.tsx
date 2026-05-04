import { requireRole } from "@/lib/auth/session";
import { AdminShell } from "@/components/layout/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("super_admin", "org_admin", "branch_manager", "viewer");

  return (
    <AdminShell user={session.user}>{children}</AdminShell>
  );
}
