// Playland · ตั้งค่างานดูแลร้าน → เช็กลิสต์ความปลอดภัย (ต่อสาขา) — หลังบ้าน · พื้นขาว · LOCKED tokens
// settings = ผู้ดูแลเท่านั้น (requirePlaylandAdmin) · อยู่ใต้ settings/layout (2-pane + BranchSwitcher ในหัว)
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandAdmin } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { getBranchContext } from "@/lib/playland/branch-context";
import { prisma } from "@/lib/prisma";
import { readSafetyChecklist, DEFAULT_SAFETY_ITEMS } from "@/lib/playland/safety-checklist";
import { CareSettingsClient } from "@/components/playland/settings/care-settings-client";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตั้งค่างานดูแลร้าน · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";

export default async function CareSettingsPage() {
  const session = await requireSession();
  // ตั้งค่า = ผู้ดูแลเท่านั้น (กันผู้จัดการ/พนักงานแก้เช็กลิสต์)
  requirePlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;
  const { branches, activeId, active } = await getBranchContext(orgId);
  if (!activeId) redirect("/playland/settings/branches");

  // เช็กลิสต์ปัจจุบันของสาขาที่กำลังทำงาน (BranchSwitcher ในหัว layout เปลี่ยน active ได้)
  const branch = await prisma.playlandBranch.findFirst({
    where: { id: activeId, orgId },
    select: { settings: true },
  });
  const items = readSafetyChecklist(branch?.settings);
  const branchName = active?.name ?? branches.find((b) => b.id === activeId)?.name ?? "สาขานี้";

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={20} color={BLUE} /> ตั้งค่างานดูแลร้าน</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>เช็กลิสต์ความปลอดภัยที่พนักงานใช้ตรวจก่อนเปิด-ปิดร้าน · ตั้งทีละสาขา</div>
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        <CareSettingsClient
          branchId={activeId}
          branchName={branchName}
          initialItems={items}
          defaultItems={DEFAULT_SAFETY_ITEMS}
        />
      </div>
    </div>
  );
}
