import { requireRole } from "@/lib/auth/session";
import { AdminShell } from "@/components/layout/admin-shell";
import {
  loadCompaniesForOrg,
  readCompanyCookie,
} from "@/lib/auth/company-context";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("super_admin", "org_admin", "branch_manager", "viewer");

  const [companies, currentCompanyId] = await Promise.all([
    loadCompaniesForOrg(session.user.org_id),
    readCompanyCookie(),
  ]);

  return (
    <AdminShell
      user={session.user}
      companies={companies}
      currentCompanyId={currentCompanyId}
    >
      {children}
    </AdminShell>
  );
}
