// Playland · หน้าบ้าน (staff/kiosk) — ตรวจ · ทำความสะอาด เต็มจอ สำหรับพนักงานหน้าร้าน
// ใช้ฟอร์มเดิม (SafetyForm) ในกรอบ kiosk เต็มจอ
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { getBranchContext } from "@/lib/playland/branch-context";
import { SafetyForm } from "@/components/playland/safety-form";
import { StaffScreenShell } from "@/components/playland/care/staff-screen-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "ตรวจ · ทำความสะอาด · หน้าร้าน · Play a lot" };

const MUTED = "#8a7f70";

export default async function CareSafetyPage() {
  const session = await requireSession();
  requirePlaylandCashier(session.user.role);
  const { activeId } = await getBranchContext(session.user.org_id);

  if (!activeId) {
    return (
      <StaffScreenShell title="ตรวจ · ทำความสะอาด" subtitle="สำหรับพนักงานหน้าร้าน">
        <div style={{ color: MUTED, fontSize: 15, padding: "40px 0", textAlign: "center" }}>
          เลือกสาขาก่อนเริ่มบันทึก
        </div>
      </StaffScreenShell>
    );
  }

  return (
    <StaffScreenShell title="ตรวจ · ทำความสะอาด" subtitle="สำหรับพนักงานหน้าร้าน">
      <SafetyForm branchId={activeId} />
    </StaffScreenShell>
  );
}
