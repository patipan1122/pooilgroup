// /repairs/new — internal create form (admin/staff). Wraps PublicRepairForm
// under the SubHeader; reporter is pre-filled from session.
import { requireSession } from "@/lib/auth/session";
import { requireRepairWrite } from "@/lib/repair/role-guard";
import { prisma } from "@/lib/prisma";
import { PublicRepairForm } from "@/components/repair/public-form";
import { RepairSubHeader } from "@/components/repair/sub-header";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminCreateTicketPage() {
  const session = await requireSession();
  requireRepairWrite(session.user.role);
  const orgId = session.user.org_id;

  const [companies, branches, categories] = await Promise.all([
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, code: true },
    }),
    prisma.branch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, code: true, businessType: true, companyId: true },
      orderBy: { name: "asc" },
    }),
    prisma.repairCategory.findMany({
      where: { orgId, isActive: true },
      select: { id: true, slug: true, label: true, emoji: true, defaultUrgency: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <>
      <RepairSubHeader
        icon={Plus}
        eyebrow="Tickets · New"
        title="เปิดใบแจ้งซ่อมใหม่"
        subtitle={`กรอกแบบเดียวกับฟอร์มสาธารณะ · ระบบจะบันทึก ${session.user.name} เป็นผู้เปิดใบ`}
        backHref="/repairs/triage"
        crumbs={[{ label: "Triage", href: "/repairs/triage" }, { label: "ใหม่" }]}
      />
      <div className="p-3 sm:p-5 lg:p-6 max-w-[1100px] mx-auto">
        <PublicRepairForm
          orgName="ภายในระบบ"
          companies={companies.map((c) => ({ id: c.id, name: c.name, code: c.code }))}
          branches={branches.map((b) => ({
            id: b.id,
            name: b.name,
            code: b.code,
            business_type: b.businessType as string,
            company_id: b.companyId,
          }))}
          categories={categories.map((c) => ({
            id: c.id,
            slug: c.slug,
            label: c.label,
            emoji: c.emoji,
            default_urgency: c.defaultUrgency as "URGENT" | "NORMAL" | "LOW",
          }))}
        />
      </div>
    </>
  );
}
