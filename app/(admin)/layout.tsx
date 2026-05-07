import { requireRole } from "@/lib/auth/session";
import { AdminShell } from "@/components/layout/admin-shell";
import { ImpersonationBar } from "@/components/impersonation-bar";
import {
  loadCompaniesForOrg,
  readCompanyCookie,
} from "@/lib/auth/company-context";
import { loadNavCounts } from "@/lib/nav/counts";
import { loadUserModules } from "@/lib/auth/module-access";

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
  // Allow every active role into the admin shell — actual page-level gating
  // (e.g. /users, /audit) still uses requireRole inside the page. Broader
  // access here lets a super_admin impersonate any role and not get bounced
  // by the layout itself.
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "branch_manager",
    "staff",
    "driver",
    "viewer",
  );

  const isAdmin =
    session.user.role === "super_admin" ||
    session.user.role === "org_admin" ||
    session.user.role === "admin";

  const [companies, currentCompanyId, navCounts, userModules] = await Promise.all([
    loadCompaniesForOrg(session.user.org_id),
    readCompanyCookie(),
    // Only admins see Manage/System zones — skip the count query for others.
    isAdmin
      ? loadNavCounts(session.user.org_id)
      : Promise.resolve({ pendingRegisterRequests: 0, branchesMissingMgr: 0 }),
    loadUserModules(session.user),
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
        navCounts={navCounts}
        userModules={Array.from(userModules)}
      >
        {children}
      </AdminShell>
    </>
  );
}
