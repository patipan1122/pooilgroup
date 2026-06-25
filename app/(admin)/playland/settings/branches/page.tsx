import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { canPlaylandAdmin } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { BranchesClient } from "@/components/playland/settings/branches-client";
import { StaffBranchManager } from "@/components/playland/settings/staff-branch-manager";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const isAdmin = canPlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role)); // ตั้งพนักงานประจำสาขา = ผู้ดูแลเท่านั้น

  let users: { id: string; name: string; email: string | null; role: string }[] = [];
  let assignments: { userId: string; branchId: string }[] = [];
  if (isAdmin) {
    [users, assignments] = await Promise.all([
      prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
      prisma.playlandStaffBranch.findMany({ where: { orgId }, select: { userId: true, branchId: true } }),
    ]);
  }

  const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
  const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
  const MITR = "var(--font-mitr), 'Mitr', sans-serif";

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><Users size={20} color={BLUE} /> ทีม &amp; สาขา</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>จัดการสาขา · ผูกพนักงานเข้าสาขา · กำหนดสิทธิ์การมองเห็น</div>
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        <BranchesClient branches={branches.map((b) => ({
          id: b.id, name: b.name, slug: b.slug, address: b.address, phone: b.phone, active: b.active,
          settings: (b.settings as Record<string, unknown> | null) ?? null,
        }))} />
        {isAdmin && branches.length > 0 && (
          <StaffBranchManager
            branches={branches.map((b) => ({ id: b.id, name: b.name }))}
            users={users}
            assignments={assignments}
          />
        )}
      </div>
    </div>
  );
}
