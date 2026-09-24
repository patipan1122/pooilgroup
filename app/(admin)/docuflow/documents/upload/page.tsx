// DocuFlow — Upload page (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopUpload canvas:
//   hero dropzone (visual) · AI auto-fill banner · structured form right.
// ────────────────────────────────────────────────────────────────────

import { Sparkles, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireProgramAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TYPE_LIST } from "@/constants/business-types";
import { listDocumentTypesForUpload } from "@/lib/docuflow/document-types";
import { listDocumentGroups } from "@/lib/docuflow/document-groups";
import { UploadForm } from "@/components/docuflow/upload-form";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ businessType?: string }>;
}

export default async function DocumentUploadPage({ searchParams }: PageProps) {
  const session = await requireSession();
  requireProgramAdminTier(session.user.role);
  const orgId = session.user.org_id;
  const { businessType } = await searchParams;

  const [companies, branches, users, documentTypes, documentGroups] =
    await Promise.all([
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
        orderBy: { code: "asc" },
      }),
      prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      listDocumentTypesForUpload(orgId),
      listDocumentGroups(orgId),
    ]);

  const businessTypes = BUSINESS_TYPE_LIST.map((b) => ({
    value: b.type,
    label: b.label,
    emoji: b.emoji,
  }));

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "อัปโหลด" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>อัปโหลดเอกสาร</DfEyebrow>}
        title={
          <>
            ลากไฟล์มาวาง{" "}
            <span style={{ color: "var(--df-muted)" }}>—</span>{" "}
            ที่เหลือ AI จัดการให้
          </>
        }
        description="รองรับ PDF · รูป · DOCX · ZIP · อัปโหลดได้สูงสุด 50 ไฟล์/ครั้ง"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        <div className="df-fade-up df-fade-up-100">
          {/* Dropzone + real per-file upload status list are both rendered
              inside UploadForm itself (right column) — it owns the files/
              status state end-to-end, so there's no separate queue preview
              here anymore (the old version was a static demo array, not
              real data). */}

          <DfCard padding={20} warm>
            <DfEyebrow>วิธีใช้</DfEyebrow>
            <ol
              style={{
                margin: "10px 0 0",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--df-ink-2)",
                lineHeight: 1.7,
              }}
            >
              <li>เลือกไฟล์ (PDF · รูป · DOCX · ZIP)</li>
              <li>กรอกข้อมูลที่จำเป็นในแบบฟอร์ม</li>
              <li>กด <b>&quot;อัปโหลด&quot;</b> · ระบบจะส่ง notification ถึงผู้รับผิดชอบ</li>
              <li>หากกรอกวันหมดอายุ — ระบบจะเตือนล่วงหน้า 90/30/7 วัน</li>
            </ol>
            <div style={{ marginTop: 14 }}>
              <DfPill tone="brand" small>
                <Sparkles size={11} /> รองรับการอัปโหลดหลายไฟล์พร้อมกัน
              </DfPill>
            </div>
          </DfCard>

          <DfCard padding={20} style={{ marginTop: 14 }}>
            <DfEyebrow>เคล็ดลับ</DfEyebrow>
            <div
              style={{
                marginTop: 10,
                fontSize: 13,
                color: "var(--df-ink-2)",
                lineHeight: 1.6,
              }}
            >
              อยากตั้งค่ารายละเอียดเอง — เช่น กำหนดประเภทเอกสาร, มอบหมายผู้รับผิดชอบ, ใส่ tag — ใช้แบบฟอร์มข้าง ๆ
            </div>
            <DfButton
              href="/docuflow/documents/upload/template"
              variant="ghost"
              size="sm"
              style={{ marginTop: 12 }}
            >
              <FileText size={13} />
              ใช้ template สำเร็จรูป
            </DfButton>
          </DfCard>
        </div>

        <div className="df-fade-up df-fade-up-200">
          <DfCard padding={24}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div>
                <DfEyebrow>กรอกข้อมูล</DfEyebrow>
                <h2
                  className="df-serif"
                  style={{ fontSize: 20, marginTop: 6, marginBottom: 0 }}
                >
                  ข้อมูลเอกสาร
                </h2>
              </div>
              <DfPill tone="brand" small>
                <Sparkles size={11} /> AI auto-fill
              </DfPill>
            </div>

            <div
              style={{
                padding: "12px 14px",
                background: "var(--df-brand-soft)",
                borderRadius: 10,
                marginBottom: 18,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <Sparkles size={16} style={{ color: "var(--df-brand)" }} />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--df-brand-deep)",
                    marginBottom: 2,
                  }}
                >
                  AI ช่วยอ่านชื่อเอกสาร + วันหมดอายุ
                </div>
                <div style={{ color: "var(--df-ink-2)" }}>
                  หลังอัปโหลดเสร็จ — กดปุ่ม <b>&quot;AI วิเคราะห์&quot;</b>{" "}
                  ในหน้าเอกสารเพื่อให้ระบบเติม metadata ให้
                </div>
              </div>
            </div>

            <UploadForm
              companies={companies}
              branches={branches}
              users={users}
              businessTypes={businessTypes}
              documentTypes={documentTypes}
              documentGroups={documentGroups}
              orgId={orgId}
              defaultBusinessType={businessType}
            />
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
