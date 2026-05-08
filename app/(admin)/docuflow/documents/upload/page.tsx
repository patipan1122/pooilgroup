// DocuFlow — Upload page (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Server component shell. Loads companies/branches/users for the
// ownership picker, then renders the client UploadForm.
// ────────────────────────────────────────────────────────────────────

import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { BackButton } from "@/components/ui/back-button";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import { UploadForm } from "@/components/docuflow/upload-form";

export const dynamic = "force-dynamic";

export default async function DocumentUploadPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const [companies, branches, users] = await Promise.all([
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        companyId: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const businessTypes = BUSINESS_TYPE_LIST.map((b) => ({
    value: b.type,
    label: b.label,
    emoji: b.emoji,
  }));

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <BackButton fallbackHref="/docuflow/documents" />
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[0.95]">
          อัปโหลด <span className="text-gradient-blue">เอกสารใหม่</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          เลือกไฟล์ ติดแท็ก กำหนดวันหมดอายุ — ระบบเก็บไว้ใน R2
        </p>
      </header>

      <Section
        number="01"
        label="UPLOAD"
        title="ข้อมูลเอกสาร"
        className="animate-fade-up delay-100"
      >
        <Card>
          <CardBody className="p-5 sm:p-6">
            <UploadForm
              companies={companies}
              branches={branches}
              users={users}
              businessTypes={businessTypes}
            />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
