// DocuFlow · Settings → Document types (CRUD)
// ────────────────────────────────────────────────────────────────────
// DocuFlow redesign Track A · Item 1. Full CRUD for the org-managed
// `document_types` table (see lib/docuflow/document-types.ts, prisma
// model DocumentType). Includes the ONE explicit "นำเข้าจากรายการมาตรฐาน"
// action that bulk-creates rows from lib/docuflow/canonical-docs.ts —
// never automatic, always admin-triggered from this page.
//
// Gate: requireProgramAdminTier — see settings/page.tsx header comment
// for why this (not requireAdminTier) matches the current codebase
// convention for DocuFlow admin-only pages.
// ────────────────────────────────────────────────────────────────────

import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireProgramAdminTier } from "@/lib/auth/role-guards";
import { listAllDocumentTypesForAdmin } from "@/lib/docuflow/document-types";
import {
  listSupportedBizTypes,
  getCanonicalDocsForBizType,
} from "@/lib/docuflow/canonical-docs";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { DfButton, DfEyebrow, DfPageHeader } from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";
import { DocumentTypeManager } from "@/components/docuflow/document-type-manager";

export const dynamic = "force-dynamic";

// FuelOS biztypes ที่ไม่มีใน BUSINESS_TYPES registry — เหมือน checklist/page.tsx
const EXTRA_BIZTYPE_META: Record<string, { label: string; emoji: string }> = {
  transport: { label: "ขนส่ง", emoji: "🚛" },
  gas_fleet: { label: "รถก๊าซ/Delivery", emoji: "🚚" },
};

export default async function DocumentTypesSettingsPage() {
  const session = await requireSession();
  requireProgramAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const documentTypes = await listAllDocumentTypesForAdmin(orgId);

  const businessTypeOptions = listSupportedBizTypes().map((bt) => {
    const meta = BUSINESS_TYPES[bt] ?? EXTRA_BIZTYPE_META[bt] ?? { label: bt, emoji: "📦" };
    return {
      value: bt,
      label: `${meta.emoji} ${meta.label}`,
      canonicalCount: getCanonicalDocsForBizType(bt).length,
    };
  });

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <DfTopBanner
        breadcrumbs={[
          { label: "หน้าหลัก", href: "/docuflow" },
          { label: "ตั้งค่า", href: "/docuflow/settings" },
          { label: "ประเภทเอกสาร" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า · ประเภทเอกสาร</DfEyebrow>}
        title="ประเภทเอกสาร"
        description="สร้าง/แก้ไขประเภทเอกสารที่ใช้กรองและจัดหมวดเอกสารทั้งองค์กร"
        actions={
          <DfButton href="/docuflow/settings" variant="ghost" size="sm">
            <ArrowLeft size={14} />
            กลับหน้าตั้งค่า
          </DfButton>
        }
      />

      <DocumentTypeManager
        initialDocumentTypes={documentTypes.map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          businessType: d.businessType,
          frequency: d.frequency,
          dangerLevel: d.dangerLevel,
          regulator: d.regulator,
          description: d.description,
          isActive: d.isActive,
        }))}
        businessTypeOptions={businessTypeOptions}
      />
    </div>
  );
}
