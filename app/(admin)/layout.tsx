import { requireRole } from "@/lib/auth/session";
import { AdminShell } from "@/components/layout/admin-shell";
import { ImpersonationBar } from "@/components/impersonation-bar";
import {
  loadCompaniesForOrg,
  readCompanyCookie,
} from "@/lib/auth/company-context";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "Manager",
  area_manager: "Area Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "branch_manager",
    "viewer",
  );

  const [companies, currentCompanyId] = await Promise.all([
    loadCompaniesForOrg(session.user.org_id),
    readCompanyCookie(),
  ]);

  return (
    <>
      {session.actingAs && (
        <ImpersonationBar
          targetName={session.user.name}
          targetRoleLabel={ROLE_LABEL[session.user.role] ?? session.user.role}
          realAdminName={session.actingAs.realUser.name}
        />
      )}
      <AdminShell
        user={session.user}
        companies={companies}
        currentCompanyId={currentCompanyId}
      >
        {children}
      </AdminShell>
    </>
  );
}
