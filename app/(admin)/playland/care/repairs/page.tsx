// Playland · หน้าบ้าน (staff/kiosk) — บันทึกซ่อม · อะไหล่ เต็มจอ สำหรับช่าง/พนักงานหน้าร้าน
// ใช้ฟอร์มเดิม (RepairForm) ในกรอบ kiosk เต็มจอ · ดึงอะไหล่ + ชื่อเครื่องที่เคยซ่อมแบบเดียวกับหลังบ้าน
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { RepairForm } from "@/components/playland/repair-form";
import { StaffScreenShell } from "@/components/playland/care/staff-screen-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "บันทึกซ่อม · อะไหล่ · หน้าร้าน · Play a lot" };

const MUTED = "#8a7f70";

export default async function CareRepairsPage() {
  const session = await requireSession();
  requirePlaylandCashier(session.user.role);
  const orgId = session.user.org_id;
  const { activeId } = await getBranchContext(orgId);

  if (!activeId) {
    return (
      <StaffScreenShell title="บันทึกซ่อม · อะไหล่" subtitle="สำหรับพนักงานหน้าร้าน">
        <div style={{ color: MUTED, fontSize: 15, padding: "40px 0", textAlign: "center" }}>
          เลือกสาขาก่อนเริ่มบันทึก
        </div>
      </StaffScreenShell>
    );
  }

  // อะไหล่ (SPARE_PART) + ชื่อเครื่องที่เคยซ่อม → autocomplete (เหมือนหลังบ้าน /playland/repairs)
  const [parts, repairs] = await Promise.all([
    prisma.playlandProduct.findMany({
      where: { orgId, branchId: activeId, active: true, kind: "SPARE_PART" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, stock: true, costCents: true, barcode: true },
    }),
    prisma.playlandRepairLog.findMany({
      where: { orgId, branchId: activeId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { machineLabel: true },
    }),
  ]);
  const machineLabels = [...new Set(repairs.map((r) => r.machineLabel))];

  return (
    <StaffScreenShell title="บันทึกซ่อม · อะไหล่" subtitle="สำหรับพนักงานหน้าร้าน">
      <RepairForm branchId={activeId} parts={parts} machineLabels={machineLabels} />
    </StaffScreenShell>
  );
}
