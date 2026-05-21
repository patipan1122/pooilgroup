// DocuFlow · Register new vehicle — admin tier only
// Server shell loads companies + branches; client form handles input

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { thaiDateLong } from "@/lib/utils/format";
import { loadBranches } from "@/lib/cashhub/data";
import { prisma } from "@/lib/prisma";
import { VEHICLE_TYPES } from "@/lib/vehicles/data";
import { NewVehicleForm } from "./new-vehicle-form";
import {
  DfCard,
  DfEyebrow,
  DfPageHeader,
} from "@/components/docuflow/df-ui";

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
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <Link
        href="/docuflow/vehicles"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับกองรถ
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>ทะเบียนรถ · {thaiDateLong(new Date())}</DfEyebrow>}
        title={
          <>
            เพิ่ม <span style={{ color: "var(--df-brand)" }}>รถใหม่</span>
          </>
        }
        description="ลงทะเบียนรถ · เอกสาร 4 ประเภทจะเพิ่มภายหลังจากหน้ารายละเอียด"
      />

      <DfCard padding={24} className="df-fade-up df-fade-up-100">
        <DfEyebrow>ข้อมูลรถ</DfEyebrow>
        <div style={{ marginTop: 14 }}>
          <NewVehicleForm
            companies={companies}
            branches={branchOptions}
            vehicleTypes={vehicleTypeOptions}
          />
        </div>
      </DfCard>
    </div>
  );
}
