// DocuFlow — single document detail
// ────────────────────────────────────────────────────────────────────
// Server component. Reads canonical loader + presigned download URL
// directly from R2 helper (Agent A). PDF preview embed if mimeType
// matches. Admin tier sees Delete button (client form posts DELETE).
// Next 16 — params is Promise<{id}>.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  Download,
  CalendarClock,
  User as UserIcon,
  Building2,
  PenLine,
  CheckCircle2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocumentById } from "@/lib/docuflow/data";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { ExpiryBadge } from "@/components/docuflow/expiry-badge";
import { DeleteDocumentButton } from "@/components/docuflow/delete-document-button";
import { RiskAnalysisPanel } from "@/components/docuflow/risk-analysis-panel";
import { RenewalHistorySection } from "@/components/docuflow/renewal-history-section";
import {
  SharingSection,
  type SharedBranchItem,
} from "@/components/docuflow/sharing-section";
import { loadBranches } from "@/lib/cashhub/data";
import { bkkDateTime, thaiDateLong } from "@/lib/utils/format";

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

  // Build owner labels (best-effort — avoids extra round trips when no FK)
  const ownership = doc.ownership[0];
  let ownerName = "—";
  if (ownership) {
    if (ownership.level === "group") {
      ownerName = "ทั้งกลุ่ม Pooilgroup";
    } else if (ownership.level === "business_type" && ownership.businessType) {
      const cfg = BUSINESS_TYPES[ownership.businessType];
      ownerName = cfg
        ? `${cfg.emoji} ${cfg.label}`
        : ownership.businessType;
    } else if (ownership.level === "company" && ownership.companyId) {
      const c = await prisma.company.findFirst({
        where: { id: ownership.companyId, orgId },
        select: { name: true, code: true },
      });
      ownerName = c ? `${c.name}` : "—";
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
      ownerName = u ? `${u.name}` : "—";
    }
  }

  const downloadUrl = await getSignedDownloadUrl(doc.fileKey).catch(() => null);
  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType?.startsWith("image/") ?? false;

  // Signature placements — count for status indicator (capability I)
  const [placementTotal, placementSigned] = await Promise.all([
    prisma.documentSignaturePlacement.count({
      where: { orgId, documentId: id },
    }),
    prisma.documentSignaturePlacement.count({
      where: { orgId, documentId: id, signedAt: { not: null } },
    }),
  ]);
  const allSigned = placementTotal > 0 && placementSigned === placementTotal;

  // Cross-branch sharing — load current shares + full org branch list (for picker).
  // Single Source: use loadBranches() canonical loader for the picker options.
  const [sharedRows, allBranchRows] = await Promise.all([
    prisma.documentSharedBranch.findMany({
      where: { orgId, documentId: id },
      include: {
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
            businessType: true,
          },
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

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <BackButton fallbackHref="/docuflow/documents" />
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display leading-[0.95] line-clamp-2">
              {doc.name}
            </h1>
            {doc.description && (
              <p className="text-zinc-600 mt-2 text-sm leading-relaxed max-w-2xl">
                {doc.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {adminTier && isPdf && (
              <Link
                href={`/docuflow/documents/${doc.id}/signatures`}
                className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] h-10 px-4 text-sm rounded-xl shadow-soft"
              >
                <PenLine className="size-4" />
                {placementTotal === 0
                  ? "ตั้งจุดเซ็น"
                  : "เซ็นเอกสาร"}
              </Link>
            )}
            {downloadUrl && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-10 px-4 text-sm rounded-xl"
              >
                <Download className="size-4" />
                ดาวน์โหลด
              </a>
            )}
            {adminTier && <DeleteDocumentButton id={doc.id} name={doc.name} />}
          </div>
        </div>
        {/* Signature progress indicator (capability I) */}
        {placementTotal > 0 && (
          <div className="mt-3 inline-flex items-center gap-2">
            <Badge tone={allSigned ? "success" : "warning"}>
              {allSigned ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <PenLine className="size-3" />
              )}
              ลายเซ็น: {placementSigned}/{placementTotal} ลงนามแล้ว
            </Badge>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section
            number="01"
            label="ตัวอย่าง"
            title="ดูตัวอย่างเอกสาร"
            className="animate-fade-up delay-100"
          >
            <Card>
              <CardBody className="p-0 overflow-hidden">
                {downloadUrl && isPdf && (
                  <iframe
                    src={downloadUrl}
                    title={doc.name}
                    className="w-full h-[640px] rounded-xl bg-zinc-50"
                  />
                )}
                {downloadUrl && isImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={downloadUrl}
                    alt={doc.name}
                    className="w-full max-h-[640px] object-contain bg-zinc-50"
                  />
                )}
                {(!downloadUrl || (!isPdf && !isImage)) && (
                  <div className="p-10 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="size-14 rounded-2xl bg-zinc-50 border-2 border-zinc-200 flex items-center justify-center text-zinc-500">
                      <FileText className="size-6" />
                    </div>
                    <p className="text-sm text-zinc-600">
                      ไฟล์นี้ไม่รองรับ Preview
                      <br />
                      กดปุ่ม &ldquo;ดาวน์โหลด&rdquo; ด้านบนเพื่อเปิดไฟล์
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>
          </Section>

          <RiskAnalysisPanel
            documentId={doc.id}
            canAnalyze={adminTier}
            documentName={doc.name}
          />

          <RenewalHistorySection
            documentId={doc.id}
            orgId={orgId}
            canExtract={adminTier}
          />
        </div>

        <div className="space-y-6">
          <Section
            number="02"
            label="ผู้ครอบครอง"
            title="ผู้ใช้งานเอกสาร"
            className="animate-fade-up delay-200"
          >
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <Building2 className="size-4 text-zinc-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-zinc-500">
                      ระดับ
                    </p>
                    <p className="text-sm text-zinc-900 font-medium mt-0.5">
                      {ownership
                        ? LEVEL_LABEL[ownership.level] ?? ownership.level
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <UserIcon className="size-4 text-zinc-400 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-500">
                      เจ้าของ
                    </p>
                    <p className="text-sm text-zinc-900 font-medium mt-0.5 truncate">
                      {ownerName}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <CalendarClock className="size-4 text-zinc-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-zinc-500">
                      อัปโหลดเมื่อ
                    </p>
                    <p className="text-sm text-zinc-900 font-medium mt-0.5">
                      {bkkDateTime(doc.uploadedAt)}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Section>

          {doc.tags.length > 0 && (
            <Section
              number="03"
              label="แท็ก"
              title="แท็ก"
              className="animate-fade-up delay-300"
            >
              <Card>
                <CardBody>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.tags.map((t) => (
                      <Badge key={t} tone="brand">
                        #{t}
                      </Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </Section>
          )}

          {doc.renewal && (
            <Section
              number="04"
              label="ต่ออายุ"
              title="วันหมดอายุ"
              className="animate-fade-up delay-300"
            >
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-zinc-600">สถานะ</p>
                    <ExpiryBadge
                      status={doc.renewal.expiryStatus}
                      days={doc.renewal.daysUntilExpiry}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-zinc-600">วันหมดอายุ</p>
                    <p className="text-sm font-medium tabular-nums">
                      {thaiDateLong(doc.renewal.expiryDate)}
                    </p>
                  </div>
                  {doc.renewal.alertDays.length > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-zinc-600">แจ้งเตือนก่อน</p>
                      <p className="text-sm font-medium tabular-nums">
                        {doc.renewal.alertDays.join(", ")} วัน
                      </p>
                    </div>
                  )}
                  {doc.renewal.notes && (
                    <div>
                      <p className="text-sm text-zinc-600">หมายเหตุ</p>
                      <p className="text-sm text-zinc-900 mt-1 leading-relaxed">
                        {doc.renewal.notes}
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Section>
          )}

          <SharingSection
            documentId={doc.id}
            sharedBranches={sharedBranches}
            allBranches={allBranchesForPicker}
            number="05"
            canEdit={adminTier}
          />
        </div>
      </div>
    </div>
  );
}
