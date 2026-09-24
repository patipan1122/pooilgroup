// DocuFlow · Settings → Document groups (CRUD)
// ────────────────────────────────────────────────────────────────────
// Parallel page to settings/document-types/page.tsx but for the SECOND,
// INDEPENDENT taxonomy dimension `document_groups` (see
// lib/docuflow/document-groups.ts, prisma model DocumentGroup). Unlike
// DocumentType there is no canonical/static catalog behind this — groups
// are whatever the admin creates, so this page has no import action.
//
// Gate: requireProgramAdminTier — same as settings/document-types/page.tsx
// (see that file's header comment for why this, not requireAdminTier).
// ────────────────────────────────────────────────────────────────────

import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireProgramAdminTier } from "@/lib/auth/role-guards";
import { listAllDocumentGroupsForAdmin } from "@/lib/docuflow/document-groups";
import { DfButton, DfEyebrow, DfPageHeader } from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";
import { DocumentGroupManager } from "@/components/docuflow/document-group-manager";

export const dynamic = "force-dynamic";

export default async function DocumentGroupsSettingsPage() {
  const session = await requireSession();
  requireProgramAdminTier(session.user.role);
  const orgId = session.user.org_id;

  const documentGroups = await listAllDocumentGroupsForAdmin(orgId);

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
          { label: "กลุ่มเอกสาร" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>ตั้งค่า · กลุ่มเอกสาร</DfEyebrow>}
        title="กลุ่มเอกสาร"
        description="สร้าง/แก้ไขกลุ่มเอกสารอิสระขององค์กร — แยกจากประเภทเอกสาร ใช้จัดกลุ่มเอกสารได้ตามต้องการ"
        actions={
          <DfButton href="/docuflow/settings" variant="ghost" size="sm">
            <ArrowLeft size={14} />
            กลับหน้าตั้งค่า
          </DfButton>
        }
      />

      <DocumentGroupManager
        initialDocumentGroups={documentGroups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          isActive: g.isActive,
        }))}
      />
    </div>
  );
}
