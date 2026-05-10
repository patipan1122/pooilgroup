// DocuFlow — Smart Upload · Step 1 (Template Picker)
// ────────────────────────────────────────────────────────────────────
// User เลือก doc template จาก canonical-docs.ts (filtered by org's biztypes)
// → redirect ไป /docuflow/documents/upload?template=BIZTYPE:NAME
// UploadForm อ่าน searchParams แล้ว pre-fill ทุก field
//
// "ไม่อยู่ในรายการ — กรอกเอง" → /docuflow/documents/upload (no template)
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { BackButton } from "@/components/ui/back-button";
import { thaiDateLong } from "@/lib/utils/format";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import {
  getCanonicalDocsForBizType,
  DOC_DANGER_TONE,
  type CanonicalDocSpec,
  type DocDangerLevel,
} from "@/lib/docuflow/canonical-docs";
import { TemplatePicker } from "@/components/docuflow/template-picker";

export const dynamic = "force-dynamic";

interface TypeGroup {
  bizType: string;
  emoji: string;
  label: string;
  docs: CanonicalDocSpec[];
}

const DANGER_BADGE_LABEL: Record<DocDangerLevel, string> = {
  critical: "วิกฤต",
  high: "สำคัญ",
  medium: "ปานกลาง",
  low: "ทั่วไป",
};

export default async function UploadTemplatePickerPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  // Find which biztypes Pooilgroup actually operates → filter the picker
  const bizTypesInOrg = await prisma.branch.findMany({
    where: { orgId, isActive: true },
    select: { businessType: true },
    distinct: ["businessType"],
  });

  const bizSet = new Set(bizTypesInOrg.map((b) => b.businessType));

  // Build groups (only biztypes the org has + has canonical docs)
  const groups: TypeGroup[] = [];
  for (const b of BUSINESS_TYPE_LIST) {
    if (!bizSet.has(b.type)) continue;
    const docs = getCanonicalDocsForBizType(b.type);
    if (docs.length === 0) continue;
    groups.push({
      bizType: String(b.type),
      emoji: b.emoji,
      label: b.label,
      docs,
    });
  }

  // Group "personnel" docs separately (they apply across all biztypes — show once)
  const seenNames = new Set<string>();
  const personnelDocs: Array<{ bizType: string; spec: CanonicalDocSpec }> = [];
  for (const g of groups) {
    for (const d of g.docs) {
      if (d.category === "personnel" && !seenNames.has(d.name)) {
        seenNames.add(d.name);
        personnelDocs.push({ bizType: g.bizType, spec: d });
      }
    }
  }

  // Filter out personnel docs from biztype groups (show in dedicated section)
  const businessGroups = groups.map((g) => ({
    ...g,
    docs: g.docs.filter((d) => d.category !== "personnel"),
  }));

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <BackButton fallbackHref="/docuflow" />
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[0.95]">
          กำลังอัปโหลด <span className="text-gradient-blue">เอกสารอะไร?</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          เลือกประเภทเอกสาร — ระบบจะกรอกชื่อ · ระดับ · วันหมดอายุ · แท็ก ให้อัตโนมัติ
        </p>
      </header>

      <Section
        number="01"
        label="STEP 1"
        title="เลือกประเภทเอกสาร"
        description="พิมพ์ค้นหา หรือเลือกจากรายการตามประเภทธุรกิจ"
        className="mb-10 animate-fade-up delay-100"
      >
        <Card>
          <CardBody className="p-4 sm:p-5">
            <TemplatePicker
              groups={businessGroups}
              personnelDocs={personnelDocs}
              dangerLabel={DANGER_BADGE_LABEL}
              dangerTone={DOC_DANGER_TONE}
            />
          </CardBody>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-zinc-500 mb-2">
            เอกสารพิเศษไม่อยู่ในรายการ?
          </p>
          <Link
            href="/docuflow/documents/upload"
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-700 border-2 border-zinc-200 hover:border-zinc-300 active:bg-zinc-50 h-10 px-5 text-sm rounded-xl"
          >
            กรอกข้อมูลเอง
          </Link>
        </div>
      </Section>
    </div>
  );
}
