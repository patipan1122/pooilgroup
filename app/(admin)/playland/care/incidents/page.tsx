// Playland · หน้าบ้าน (staff/kiosk) — บันทึกอุบัติเหตุ/เหตุการณ์ เต็มจอ สำหรับพนักงานหน้าร้าน
// ใช้ฟอร์มเดิม (IncidentForm) ในกรอบ kiosk เต็มจอ · หลังบ้านอ่านอย่างเดียวแยกต่างหาก
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandCashier } from "@/lib/playland/role-guard";
import { getBranchContext } from "@/lib/playland/branch-context";
import { IncidentForm } from "@/components/playland/incident-form";
import { StaffScreenShell } from "@/components/playland/care/staff-screen-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "บันทึกอุบัติเหตุ · หน้าร้าน · Play a lot" };

const MUTED = "#8a7f70";

export default async function CareIncidentsPage() {
  const session = await requireSession();
  requirePlaylandCashier(session.user.role);
  const { activeId } = await getBranchContext(session.user.org_id);

  if (!activeId) {
    return (
      <StaffScreenShell title="บันทึกอุบัติเหตุ/เหตุการณ์" subtitle="สำหรับพนักงานหน้าร้าน">
        <div style={{ color: MUTED, fontSize: 15, padding: "40px 0", textAlign: "center" }}>
          เลือกสาขาก่อนเริ่มบันทึก
        </div>
      </StaffScreenShell>
    );
  }

  return (
    <StaffScreenShell title="บันทึกอุบัติเหตุ/เหตุการณ์" subtitle="สำหรับพนักงานหน้าร้าน">
      <IncidentForm branchId={activeId} />
    </StaffScreenShell>
  );
}
