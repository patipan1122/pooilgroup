// /repairs/technicians — manage internal & vendor technicians
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import { listTechnicians } from "@/lib/repair/queries";
import { TechnicianAdmin } from "@/components/repair/technician-admin";

export const dynamic = "force-dynamic";

export default async function TechniciansPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const techs = await listTechnicians(session.user.org_id, false);

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
          จัดการช่าง
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          ช่างใน (พนักงานบริษัท) + ช่างนอก (vendor) · เพิ่ม / ปิดการใช้งาน
        </p>
      </header>
      <TechnicianAdmin
        technicians={techs.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          phone: t.phone,
          lineId: t.lineId,
          specialties: t.specialties,
          isActive: t.isActive,
          userName: t.user?.name ?? null,
        }))}
      />
    </div>
  );
}
