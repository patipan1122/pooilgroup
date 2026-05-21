// /repairs/technicians — manage internal & vendor technicians (Pooil App redesign)
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import { listTechnicians, technicianWorkload } from "@/lib/repair/queries";
import { TechnicianAdmin } from "@/components/repair/technician-admin";
import { RepairSubHeader } from "@/components/repair/sub-header";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TechniciansPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const orgId = session.user.org_id;

  const [techs, workload] = await Promise.all([
    listTechnicians(orgId, false),
    technicianWorkload(orgId),
  ]);

  const workloadMap = new Map(workload.map((w) => [w.tech.id, w]));

  // Annotate each tech with their open/urgent counts.
  const enriched = techs.map((t) => {
    const w = workloadMap.get(t.id);
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      phone: t.phone,
      lineId: t.lineId,
      specialties: t.specialties,
      isActive: t.isActive,
      userName: t.user?.name ?? null,
      activeJobs: w?.active ?? 0,
      urgentJobs: w?.urgent ?? 0,
    };
  });

  const internal = enriched.filter((t) => t.kind === "INTERNAL").length;
  const vendor = enriched.filter((t) => t.kind === "VENDOR").length;
  const active = enriched.filter((t) => t.isActive).length;
  const totalLoad = workload.reduce((s, w) => s + w.active, 0);

  return (
    <>
      <RepairSubHeader
        icon={Users}
        eyebrow="Resources · Technicians"
        title="ช่างซ่อม"
        subtitle="ช่างใน (พนักงานบริษัท) + ช่างนอก (vendor) · เพิ่ม / ปิดใช้งาน · ดู workload ปัจจุบัน"
        stats={[
          { label: "ช่างใน", value: internal },
          { label: "ช่างนอก (Vendor)", value: vendor },
          { label: "ใช้งานอยู่", value: active, tone: "success" },
          { label: "งานเปิดรวม", value: totalLoad },
        ]}
      />
      <div className="p-3 sm:p-5 lg:p-6 max-w-[1400px] mx-auto">
        <TechnicianAdmin technicians={enriched} />
      </div>
    </>
  );
}
