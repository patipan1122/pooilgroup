import { getSession } from "@/lib/auth/session";
import { LiffBootstrap } from "./liff-bootstrap";
import { ImpersonationBar } from "@/components/impersonation-bar";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "Manager",
  area_manager: "Area Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

export default async function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {session?.actingAs && (
        <ImpersonationBar
          targetName={session.user.name}
          targetRoleLabel={ROLE_LABEL[session.user.role] ?? session.user.role}
          realAdminName={session.actingAs.realUser.name}
        />
      )}
      <LiffBootstrap haveSession={!!session} />
      {children}
    </div>
  );
}
