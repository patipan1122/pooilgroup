import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { canPlaylandAdmin } from "@/lib/playland/role-guard";
import { BranchesClient } from "@/components/playland/settings/branches-client";
import { StaffBranchManager } from "@/components/playland/settings/staff-branch-manager";

export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const isAdmin = canPlaylandAdmin(session.user.role); // ตั้งพนักงานประจำสาขา = ผู้ดูแลเท่านั้น

  let users: { id: string; name: string; email: string | null; role: string }[] = [];
  let assignments: { userId: string; branchId: string }[] = [];
  if (isAdmin) {
    [users, assignments] = await Promise.all([
      prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
      prisma.playlandStaffBranch.findMany({ where: { orgId }, select: { userId: true, branchId: true } }),
    ]);
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <BranchesClient branches={branches.map((b) => ({
        id: b.id, name: b.name, slug: b.slug, address: b.address, phone: b.phone, active: b.active,
      }))} />
      {isAdmin && branches.length > 0 && (
        <div style={{ padding: "0 16px 24px" }}>
          <StaffBranchManager
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
            users={users}
            assignments={assignments}
          />
        </div>
      )}
    </div>
  );
}
