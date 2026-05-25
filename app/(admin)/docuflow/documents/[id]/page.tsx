// DocuFlow — single document detail
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopViewer canvas:
//   large preview + right meta panel · canvas-aligned chrome.
// Data layer unchanged.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  Download,
  PenLine,
  CheckCircle2,
  Share2,
  AlertTriangle,
  Eye,
  Clock,
  Tag,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocumentById } from "@/lib/docuflow/data";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { BackButton } from "@/components/ui/back-button";
import { DeleteDocumentButton } from "@/components/docuflow/delete-document-button";
import { RiskAnalysisPanel } from "@/components/docuflow/risk-analysis-panel";
import { RenewalHistorySection } from "@/components/docuflow/renewal-history-section";
import { ApprovalTimeline } from "@/components/docuflow/approval-timeline";
import {
  SharingSection,
  type SharedBranchItem,
} from "@/components/docuflow/sharing-section";
import { loadBranches } from "@/lib/cashhub/data";
import { bkkDateTime, thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPill,
  DfDocIcon,
} from "@/components/docuflow/df-ui";
import { ViewerTabs } from "@/components/docuflow/viewer-tabs";

export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<string, string> = {
  group: "ทั้งกลุ่ม",
  company: "บริษัท",
  business_type: "ประเภทธุรกิจ",
  branch: "สาขา",
  person: "บุคคล",
};

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const doc = await loadDocumentById(orgId, id);
  if (!doc || !doc.isActive) notFound();

  const ownership = doc.ownership[0];
  let ownerName = "—";
  if (ownership) {
    if (ownership.level === "group") {
      ownerName = "ทั้งกลุ่ม Pooilgroup";
    } else if (ownership.level === "business_type" && ownership.businessType) {
      const cfg = BUSINESS_TYPES[ownership.businessType];
      ownerName = cfg ? `${cfg.emoji} ${cfg.label}` : ownership.businessType;
    } else if (ownership.level === "company" && ownership.companyId) {
      const c = await prisma.company.findFirst({
        where: { id: ownership.companyId, orgId },
        select: { name: true, code: true },
      });
      ownerName = c ? c.name : "—";
    } else if (ownership.level === "branch" && ownership.branchId) {
      const b = await prisma.branch.findFirst({
        where: { id: ownership.branchId, orgId },
        select: { name: true, code: true },
      });
      ownerName = b ? `${b.code} · ${b.name}` : "—";
    } else if (ownership.level === "person" && ownership.personId) {
      const u = await prisma.user.findFirst({
        where: { id: ownership.personId, orgId },
        select: { name: true, role: true },
      });
      ownerName = u ? u.name : "—";
    }
  }

  const downloadUrl = await getSignedDownloadUrl(doc.fileKey).catch(() => null);
  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType?.startsWith("image/") ?? false;

  const [placementTotal, placementSigned, signerRows, auditRows] =
    await Promise.all([
      prisma.documentSignaturePlacement.count({
        where: { orgId, documentId: id },
      }),
      prisma.documentSignaturePlacement.count({
        where: { orgId, documentId: id, signedAt: { not: null } },
      }),
      prisma.documentSignaturePlacement.findMany({
        where: { orgId, documentId: id },
        orderBy: { ordering: "asc" },
        include: { signerUser: { select: { name: true } } },
      }),
      prisma.auditLog.findMany({
        where: {
          orgId,
          resourceType: "document",
          resourceId: id,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { name: true } } },
      }),
    ]);
  const allSigned = placementTotal > 0 && placementSigned === placementTotal;

  const signers = signerRows.map((s) => ({
    id: s.id,
    ordering: s.ordering,
    signerName: s.signerName,
    signerUserName: s.signerUser?.name ?? null,
    signerRole: s.signerRole,
    label: s.label,
    signedAt: s.signedAt,
  }));
  const auditEvents = auditRows.map((a) => ({
    id: a.id,
    action: a.action,
    createdAt: a.createdAt,
    userName: a.user?.name ?? null,
    diff: a.diff,
  }));

  const [sharedRows, allBranchRows] = await Promise.all([
    prisma.documentSharedBranch.findMany({
      where: { orgId, documentId: id },
      include: {
        branch: {
          select: { id: true, code: true, name: true, businessType: true },
        },
      },
      orderBy: { addedAt: "asc" },
    }),
    loadBranches(orgId, { activeOnly: true }),
  ]);
  const sharedBranches: SharedBranchItem[] = sharedRows.map((r) => ({
    id: r.branch.id,
    code: r.branch.code,
    name: r.branch.name,
    businessType: r.branch.businessType,
  }));
  const allBranchesForPicker = allBranchRows.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    business_type: b.business_type,
  }));

  const expTone =
    doc.renewal == null
      ? null
      : doc.renewal.daysUntilExpiry < 0
        ? "danger"
        : doc.renewal.daysUntilExpiry <= 30
          ? "warn"
          : "outline";
  const expText =
    doc.renewal == null
      ? null
      : doc.renewal.daysUntilExpiry < 0
        ? `หมดแล้ว ${Math.abs(doc.renewal.daysUntilExpiry)} วัน`
        : doc.renewal.daysUntilExpiry === 0
          ? "หมดวันนี้"
          : `อีก ${doc.renewal.daysUntilExpiry} วัน`;

  return (
    <div
      style={{
        padding: "20px clamp(12px, 3vw, 32px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <BackButton fallbackHref="/docuflow/documents" />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginTop: 18,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
        className="df-fade-up"
      >
        <div style={{ display: "flex", gap: 16, minWidth: 0, flex: 1 }}>
          <DfDocIcon size="lg" tone={{ bg: "#C46A3D18", fg: "#C46A3D" }}>
            <FileText size={24} />
          </DfDocIcon>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <DfPill tone="accent">เอกสาร</DfPill>
              {expTone && expText && (
                <DfPill tone={expTone as "danger" | "warn" | "outline"}>
                  <AlertTriangle size={11} /> {expText}
                </DfPill>
              )}
              {placementTotal > 0 && (
                <DfPill tone={allSigned ? "success" : "warn"}>
                  {allSigned ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                  ลายเซ็น {placementSigned}/{placementTotal}
                </DfPill>
              )}
              <span style={{ fontSize: 12, color: "var(--df-muted)" }}>
                อัปโหลด {bkkDateTime(doc.uploadedAt)}
              </span>
            </div>
            <h1
              className="df-serif"
              style={{
                fontSize: "clamp(22px, 3.5vw, 30px)",
                lineHeight: 1.15,
                margin: 0,
              }}
            >
              {doc.name}
            </h1>
            {doc.description && (
              <p
                style={{
                  color: "var(--df-muted)",
                  fontSize: 14,
                  marginTop: 8,
                  marginBottom: 0,
                  maxWidth: "60ch",
                }}
              >
                {doc.description}
              </p>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {adminTier && isPdf && (
            <DfButton
              href={`/docuflow/documents/${doc.id}/signatures`}
              variant="brand"
            >
              <PenLine size={14} />
              {placementTotal === 0 ? "ตั้งจุดเซ็น" : "เซ็นเอกสาร"}
            </DfButton>
          )}
          {downloadUrl && (
            <DfButton href={downloadUrl} variant="ghost">
              <Download size={14} />
              ดาวน์โหลด
            </DfButton>
          )}
          {adminTier && <DeleteDocumentButton id={doc.id} name={doc.name} />}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 360px)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <DfCard
            padding={0}
            className="df-fade-up df-fade-up-100"
            style={{ overflow: "hidden" }}
          >
            <ViewerTabs
              downloadUrl={downloadUrl}
              mimeType={doc.mimeType}
              docName={doc.name}
              meta={[
                ...(ownership
                  ? [
                      {
                        k: "ประเภท",
                        v:
                          LEVEL_LABEL[ownership.level] ?? ownership.level,
                      },
                    ]
                  : []),
                { k: "ผู้ครอบครอง", v: ownerName },
                { k: "อัปโหลดเมื่อ", v: bkkDateTime(doc.uploadedAt) },
                ...(doc.renewal
                  ? [
                      {
                        k: "วันหมดอายุ",
                        v: thaiDateLong(doc.renewal.expiryDate),
                      },
                    ]
                  : []),
                ...(doc.fileSize
                  ? [
                      {
                        k: "ขนาดไฟล์",
                        v: `${(doc.fileSize / 1024).toFixed(0)} KB`,
                      },
                    ]
                  : []),
                ...(doc.mimeType
                  ? [{ k: "ประเภทไฟล์", v: doc.mimeType }]
                  : []),
              ]}
              history={[
                {
                  at: bkkDateTime(doc.uploadedAt),
                  by: "ระบบ",
                  label: "อัปโหลดเอกสาร",
                  detail: doc.description ?? undefined,
                },
                ...(doc.renewal && doc.renewal.lastRenewedDate
                  ? [
                      {
                        at: thaiDateLong(doc.renewal.lastRenewedDate),
                        by: "ผู้รับผิดชอบ",
                        label: "ต่ออายุล่าสุด",
                      },
                    ]
                  : []),
                ...(placementTotal > 0
                  ? [
                      {
                        at: bkkDateTime(doc.uploadedAt),
                        by: "ระบบ",
                        label: `ตั้งจุดเซ็น ${placementTotal} จุด`,
                        detail:
                          placementSigned === placementTotal
                            ? "ลงนามครบแล้ว"
                            : `ลงนามแล้ว ${placementSigned}/${placementTotal}`,
                      },
                    ]
                  : []),
              ]}
            />
          </DfCard>

          <RiskAnalysisPanel
            documentId={doc.id}
            canAnalyze={adminTier}
            documentName={doc.name}
          />

          <ApprovalTimeline
            signers={signers}
            events={auditEvents}
            expiryDate={doc.renewal?.expiryDate ?? null}
            alertDays={doc.renewal?.alertDays}
            lastRenewedDate={doc.renewal?.lastRenewedDate ?? null}
          />

          <RenewalHistorySection
            documentId={doc.id}
            orgId={orgId}
            canExtract={adminTier}
          />
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          className="df-fade-up df-fade-up-200"
        >
          {adminTier && isPdf && (
            <DfCard padding={14}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <DfButton
                  href={`/docuflow/documents/${doc.id}/signatures`}
                  variant="brand"
                  style={{ justifyContent: "center" }}
                >
                  <PenLine size={14} />
                  ส่งให้เซ็น
                </DfButton>
                <DfButton
                  variant="ghost"
                  href={downloadUrl ?? "#"}
                  style={{ justifyContent: "center" }}
                >
                  <Download size={14} />
                  ดาวน์โหลด
                </DfButton>
              </div>
            </DfCard>
          )}

          <DfCard padding={18}>
            <DfEyebrow>รายละเอียด</DfEyebrow>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column" }}
            >
              <MetaRow label="ประเภท">
                {ownership ? LEVEL_LABEL[ownership.level] ?? ownership.level : "—"}
              </MetaRow>
              <MetaRow label="ผู้ครอบครอง">{ownerName}</MetaRow>
              <MetaRow label="อัปโหลดเมื่อ">{bkkDateTime(doc.uploadedAt)}</MetaRow>
              {doc.renewal && (
                <>
                  <MetaRow label="วันหมดอายุ">
                    {thaiDateLong(doc.renewal.expiryDate)}
                  </MetaRow>
                  {doc.renewal.alertDays.length > 0 && (
                    <MetaRow label="แจ้งเตือนก่อน">
                      {doc.renewal.alertDays.join(", ")} วัน
                    </MetaRow>
                  )}
                </>
              )}
              {doc.mimeType && (
                <MetaRow label="ประเภทไฟล์" last>
                  {doc.mimeType}
                </MetaRow>
              )}
            </div>
          </DfCard>

          {doc.tags.length > 0 && (
            <DfCard padding={18}>
              <DfEyebrow>
                <Tag size={11} style={{ display: "inline-block", marginRight: 4 }} />
                แท็ก
              </DfEyebrow>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {doc.tags.map((t) => (
                  <DfPill key={t} tone="brand" small>
                    #{t}
                  </DfPill>
                ))}
              </div>
            </DfCard>
          )}

          {doc.renewal?.notes && (
            <DfCard padding={18}>
              <DfEyebrow>หมายเหตุการต่ออายุ</DfEyebrow>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--df-ink-2)",
                  lineHeight: 1.6,
                  marginTop: 10,
                  marginBottom: 0,
                }}
              >
                {doc.renewal.notes}
              </p>
            </DfCard>
          )}

          <DfCard padding={18}>
            <DfEyebrow>
              <Share2 size={11} style={{ display: "inline-block", marginRight: 4 }} />
              แชร์ข้ามสาขา
            </DfEyebrow>
            <div style={{ marginTop: 10 }}>
              <SharingSection
                documentId={doc.id}
                sharedBranches={sharedBranches}
                allBranches={allBranchesForPicker}
                number="·"
                canEdit={adminTier}
              />
            </div>
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function MetaRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: last ? "none" : "1px solid var(--df-line-soft)",
        fontSize: 13,
        gap: 12,
      }}
    >
      <span style={{ color: "var(--df-muted)", flexShrink: 0 }}>{label}</span>
      <span
        style={{ fontWeight: 600, textAlign: "right", color: "var(--df-ink)" }}
      >
        {children}
      </span>
    </div>
  );
}
