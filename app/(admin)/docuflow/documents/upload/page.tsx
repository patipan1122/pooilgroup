// DocuFlow — Upload page (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Server component shell. Loads companies/branches/users for the
// ownership picker, then renders the client UploadForm.
//
// Phase 2 redesign 2026-05-10:
//   - Reads ?template=BIZTYPE:NAME → look up canonical doc → pass defaults
//   - Loads existing org tags → autocomplete suggestions for tag input
//   - "Step 1" entry is now /docuflow/documents/upload/template (picker)
//     This page renders Step 2 (form) — directly accessible too if user
//     clicks "กรอกข้อมูลเอง"
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import { UploadForm } from "@/components/docuflow/upload-form";
import { getCanonicalDocsForBizType } from "@/lib/docuflow/canonical-docs";
import { templateDefaults } from "@/lib/docuflow/templates";

export const dynamic = "force-dynamic";

interface SearchParams {
  template?: string;
}

export default async function DocumentUploadPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const params = await searchParams;
  const templateParam = params.template;

  // Resolve template (BIZTYPE:NAME) → defaults
  let template = null;
  let documentTypeKey: string | null = null;
  if (templateParam) {
    const sep = templateParam.indexOf(":");
    if (sep > 0) {
      const bizType = templateParam.slice(0, sep);
      const docName = templateParam.slice(sep + 1);
      const docs = getCanonicalDocsForBizType(bizType);
      const spec = docs.find((d) => d.name === docName);
      if (spec) {
        template = templateDefaults(spec);
        documentTypeKey = `${bizType}:${docName}`;
      }
    }
  }

  const [companies, branches, users, tagRows] = await Promise.all([
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
    // Pull distinct tags from this org for autocomplete
    prisma.documentTag.findMany({
      where: { orgId },
      select: { tag: true },
      distinct: ["tag"],
      take: 200,
    }),
  ]);

  const businessTypes = BUSINESS_TYPE_LIST.map((b) => ({
    value: b.type,
    label: b.label,
    emoji: b.emoji,
  }));

  const orgTagSuggestions = tagRows.map((r) => r.tag).sort();

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <Link
          href={template ? "/docuflow/documents/upload/template" : "/docuflow"}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft className="size-4" />
          กลับ
        </Link>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[0.95]">
          อัปโหลด <span className="text-gradient-blue">เอกสารใหม่</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {template
            ? "ระบบกรอกข้อมูลเริ่มต้นจาก template — ปรับและกดอัปโหลดได้เลย"
            : "เลือกไฟล์ ติดแท็ก กำหนดวันหมดอายุ — ระบบเก็บไว้ใน R2"}
        </p>
      </header>

      <Section
        number={template ? "02" : "01"}
        label={template ? "STEP 2" : "UPLOAD"}
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
              template={template}
              documentTypeKey={documentTypeKey}
              orgTagSuggestions={orgTagSuggestions}
            />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
