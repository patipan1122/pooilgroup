// Playland · ทีม & สิทธิ์ — แอดมิน/เจ้าของตั้งตำแหน่งพนักงาน → สิทธิ์ derive จากตำแหน่ง (รายสาขา)
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { canPlaylandAdmin } from "@/lib/playland/role-guard";
import { BranchSwitcher } from "@/components/playland/branch-switcher";
import { TeamPermissionsClient, type TeamUser } from "@/components/playland/settings/team-permissions-client";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;

  // gate: เจ้าของร้าน/แอดมินเท่านั้น (เช็คด้วยสิทธิ์ Playland → เจ้าของร้าน position=owner ก็เข้าได้)
  const plRole = await getPlaylandRole(session.user.id, orgId, session.user.role);
  if (!canPlaylandAdmin(plRole)) redirect("/playland");

  const { branches, activeId } = await getBranchContext(orgId);
  const branchName = branches.find((b) => b.id === activeId)?.name ?? "—";

  // พนักงานทั้ง org + ตำแหน่งของ "สาขาที่กำลังทำงาน" (active branch)
  const [users, staffRows] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
    activeId
      ? prisma.playlandStaffBranch.findMany({
          where: { orgId, branchId: activeId },
          select: { userId: true, position: true },
        })
      : Promise.resolve([] as { userId: string; position: string | null }[]),
  ]);

  const posByUser = new Map(staffRows.map((r) => [r.userId, r.position]));
  const teamUsers: TeamUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    position: posByUser.get(u.id) ?? null,
  }));

  const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
  const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
  const MITR = "var(--font-mitr), 'Mitr', sans-serif";

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <Link
          href="/playland/office"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: MUTED, textDecoration: "none", flexShrink: 0 }}
        >
          <ArrowLeft size={16} /> กลับ
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={20} color={BLUE} /> ทีม &amp; สิทธิ์
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            ตั้งตำแหน่งให้พนักงาน → สิทธิ์มาตามตำแหน่ง (เฉพาะ Playland · ไม่กระทบโปรแกรมอื่น)
          </div>
        </div>
        <BranchSwitcher branches={branches} activeId={activeId} />
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        <TeamPermissionsClient users={teamUsers} branchId={activeId} branchName={branchName} />
      </div>
    </div>
  );
}
