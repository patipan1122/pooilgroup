// DocuFlow · Register new vehicle — admin tier only
// Server shell loads companies + branches; client form handles input

import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { BackButton } from "@/components/ui/back-button";
import { thaiDateLong } from "@/lib/utils/format";
import { loadBranches } from "@/lib/cashhub/data";
import { prisma } from "@/lib/prisma";
import { VEHICLE_TYPES } from "@/lib/vehicles/data";
import { NewVehicleForm } from "./new-vehicle-form";

export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const [branches, companies] = await Promise.all([
    loadBranches(orgId, { activeOnly: true }),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const branchOptions = branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    businessType: b.business_type,
  }));

  const vehicleTypeOptions = Object.entries(VEHICLE_TYPES).map(
    ([key, cfg]) => ({
      key,
      label: `${cfg.emoji} ${cfg.label}`,
    }),
  );

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <div className="mb-4">
        <BackButton fallbackHref="/docuflow/vehicles" />
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · ทะเบียนรถ · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          เพิ่ม <span className="text-gradient-blue">รถใหม่</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          ลงทะเบียนรถ · เอกสาร 4 ประเภทจะเพิ่มภายหลังจากหน้ารายละเอียด
        </p>
      </header>

      <Section number="01" label="ลงทะเบียน" title="ข้อมูลรถ">
        <NewVehicleForm
          companies={companies}
          branches={branchOptions}
          vehicleTypes={vehicleTypeOptions}
        />
      </Section>
    </div>
  );
}
