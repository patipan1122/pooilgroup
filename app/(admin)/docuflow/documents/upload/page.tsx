// DocuFlow — Upload page (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Server component shell. Loads companies/branches/users for the
// multi-select ownership picker, then renders the client UploadForm.
//
// Phase 3 (2026-05-12): No more "template" autofill — wizard at
// /docuflow/documents/upload/template narrows scope step-by-step.
// Reads wizard query params to pre-fill ownership multi-select:
//
//   ?wizExpiry=yes|no           — has-expiry hint
//   ?wizGroup=1                 — ทั้งกลุ่ม level
//   ?wizCompanies=POIL,JPS      — company codes (multi)
//   ?wizTypes=fuel_station,...  — business types (multi)
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

export const dynamic = "force-dynamic";

interface SearchParams {
  wizExpiry?: string; // "yes" | "no"
  wizGroup?: string; // "1" → ownership.group = true
  wizCompanies?: string; // "POIL,JPS" — company codes
  wizTypes?: string; // "fuel_station,convenience_store" — biz types
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

  // Translate wizard params → initial ownership state
  const initialOwnership = {
    group: params.wizGroup === "1",
    companyIds: params.wizCompanies
      ? params.wizCompanies
          .split(",")
          .map((code) => companies.find((c) => c.code === code)?.id)
          .filter((x): x is string => Boolean(x))
      : [],
    businessTypes: params.wizTypes
      ? params.wizTypes.split(",").filter(Boolean)
      : [],
    branchIds: [] as string[],
    personIds: [] as string[],
  };

  const hasExpiry = params.wizExpiry === "yes";
  const fromWizard = Boolean(
    params.wizExpiry || params.wizGroup || params.wizCompanies,
  );

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-3xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <Link
          href={
            fromWizard ? "/docuflow/documents/upload/template" : "/docuflow"
          }
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
          {fromWizard
            ? "ระดับการใช้งานถูก pre-set จากตัวช่วย — เพิ่มเติมได้"
            : "เลือกไฟล์ ติดแท็ก กำหนดวันหมดอายุ — ระบบเก็บไว้ใน R2"}
        </p>
      </header>

      <Section
        number="04"
        label={fromWizard ? "FINAL" : "UPLOAD"}
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
              orgTagSuggestions={orgTagSuggestions}
              initialOwnership={initialOwnership}
              hasExpiryHint={
                params.wizExpiry === "yes"
                  ? "expires"
                  : params.wizExpiry === "no"
                    ? "forever"
                    : null
              }
              fromWizard={fromWizard}
            />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
