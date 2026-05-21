// DocuFlow — รายการเอกสารทั้งหมด (advanced filter)
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — canvas-aligned chrome + DfPill filters.
// Data source unchanged.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { FileText, Upload, ArrowLeft, Filter } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import {
  loadDocuments,
  loadDocumentsSharedToBranch,
  loadDocumentTags,
  type CanonicalDocument,
} from "@/lib/docuflow/data";
import type { ExpiryStatus } from "@/lib/docuflow/expiry";
import { DocumentCard } from "@/components/docuflow/document-card";
import { DocumentFilters } from "@/components/docuflow/document-filters";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

const LEVEL_CHIPS = [
  { value: "group", label: "กลุ่ม" },
  { value: "company", label: "บริษัท" },
  { value: "business_type", label: "ประเภทธุรกิจ" },
  { value: "branch", label: "สาขา" },
  { value: "person", label: "บุคคล" },
];

const EXPIRY_CHIPS: { value: ExpiryStatus; label: string }[] = [
  { value: "expired", label: "หมดแล้ว" },
  { value: "critical", label: "≤ 7 วัน" },
  { value: "urgent", label: "≤ 30 วัน" },
  { value: "watch", label: "≤ 90 วัน" },
];

interface SP {
  level?: string;
  tag?: string;
  status?: string;
  search?: string;
  branchId?: string;
  companyId?: string;
  businessType?: string;
  shared?: string;
}

export default async function DocumentsListPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const filterLevel = sp.level || "";
  const filterTag = sp.tag || "";
  const filterStatus = (sp.status || "") as ExpiryStatus | "";
  const search = sp.search || "";
  const filterBranchId = sp.branchId || "";
  const filterCompanyId = sp.companyId || "";
  const filterBusinessType = sp.businessType || "";
  const sharedOnly = sp.shared === "1";

  const [docs, allTags] = await Promise.all([
    sharedOnly && filterBranchId
      ? loadDocumentsSharedToBranch(orgId, filterBranchId, { limit: 200 })
      : loadDocuments(orgId, {
          level: filterLevel || undefined,
          branchId: filterBranchId || undefined,
          companyId: filterCompanyId || undefined,
          businessType: filterBusinessType || undefined,
          tag: filterTag || undefined,
          expiryStatus: filterStatus || undefined,
          search: search || undefined,
          limit: 200,
        }),
    loadDocumentTags(orgId),
  ]);

  const preserve: Record<string, string> = {};
  if (filterLevel) preserve.level = filterLevel;
  if (filterTag) preserve.tag = filterTag;
  if (filterStatus) preserve.status = filterStatus;
  if (search) preserve.search = search;
  if (filterBranchId) preserve.branchId = filterBranchId;
  if (filterCompanyId) preserve.companyId = filterCompanyId;
  if (filterBusinessType) preserve.businessType = filterBusinessType;
  if (sharedOnly) preserve.shared = "1";

  const tagChips = allTags.slice(0, 12).map((t) => ({ value: t, label: `#${t}` }));

  const scopeLabel = (() => {
    if (sharedOnly && filterBranchId) return "เอกสารใช้ร่วมจากสาขาอื่น";
    if (filterBranchId) return "ขอบเขต: เอกสารของสาขา";
    if (filterCompanyId) return "ขอบเขต: เอกสารของบริษัท";
    if (filterBusinessType) return "ขอบเขต: เอกสารตามประเภทธุรกิจ";
    return null;
  })();
  const scopeClearParams = new URLSearchParams();
  if (filterLevel) scopeClearParams.set("level", filterLevel);
  if (filterTag) scopeClearParams.set("tag", filterTag);
  if (filterStatus) scopeClearParams.set("status", filterStatus);
  if (search) scopeClearParams.set("search", search);
  const scopeClearHref = scopeClearParams.toString()
    ? `/docuflow/documents?${scopeClearParams.toString()}`
    : "/docuflow/documents";

  const activeFilterCount =
    (filterLevel ? 1 : 0) +
    (filterStatus ? 1 : 0) +
    (filterTag ? 1 : 0) +
    (filterBranchId ? 1 : 0) +
    (filterCompanyId ? 1 : 0) +
    (filterBusinessType ? 1 : 0);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <Link
        href="/docuflow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับ DocuFlow
      </Link>

      <DfPageHeader
        eyebrow={<DfEyebrow>เอกสาร · ค้นหาขั้นสูง</DfEyebrow>}
        title={
          <>
            พบ{" "}
            <span style={{ color: "var(--df-brand)" }}>
              {docs.length.toLocaleString("th-TH")}
            </span>{" "}
            เอกสาร
          </>
        }
        description={
          scopeLabel ? (
            <span>
              {scopeLabel} ·{" "}
              <Link
                href={scopeClearHref}
                style={{ color: "var(--df-brand)", fontWeight: 600 }}
              >
                ล้างขอบเขต
              </Link>
            </span>
          ) : (
            "ใช้ตัวกรองด้านล่างเพื่อค้นหาเอกสารตามระดับ/สถานะ/แท็ก"
          )
        }
        actions={
          adminTier ? (
            <DfButton
              href="/docuflow/documents/upload/template"
              variant="brand"
            >
              <Upload size={15} />
              อัปโหลดเอกสาร
            </DfButton>
          ) : null
        }
      />

      <DfSection
        number="01"
        label="ตัวกรอง"
        action={
          activeFilterCount > 0 ? (
            <DfPill tone="brand" small>
              <Filter size={11} /> ใช้ {activeFilterCount} เงื่อนไข
            </DfPill>
          ) : null
        }
        className="df-fade-up df-fade-up-100"
      >
        <DfCard padding={18}>
          <div style={{ marginBottom: 14 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--df-muted)",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}
            >
              ระดับ
            </p>
            <DocumentFilters
              paramKey="level"
              current={filterLevel}
              chips={LEVEL_CHIPS}
              preserve={(() => {
                const p = { ...preserve };
                delete p.level;
                return p;
              })()}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--df-muted)",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}
            >
              สถานะวันหมดอายุ
            </p>
            <DocumentFilters
              paramKey="status"
              current={filterStatus}
              chips={EXPIRY_CHIPS}
              preserve={(() => {
                const p = { ...preserve };
                delete p.status;
                return p;
              })()}
            />
          </div>
          {tagChips.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                แท็ก
              </p>
              <DocumentFilters
                paramKey="tag"
                current={filterTag}
                chips={tagChips}
                preserve={(() => {
                  const p = { ...preserve };
                  delete p.tag;
                  return p;
                })()}
              />
            </div>
          )}
        </DfCard>
      </DfSection>

      <DfSection
        number="02"
        label={`เอกสาร · ${docs.length} รายการ`}
        className="df-fade-up df-fade-up-200"
      >
        {docs.length === 0 ? (
          <DfCard padding={36} style={{ textAlign: "center" }}>
            <FileText
              size={32}
              style={{ color: "var(--df-muted)", margin: "0 auto 12px" }}
            />
            <h3
              className="df-serif"
              style={{ fontSize: 18, marginTop: 0, marginBottom: 8 }}
            >
              ไม่พบเอกสารตามเงื่อนไข
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "var(--df-muted)",
                marginBottom: 16,
                marginTop: 0,
              }}
            >
              ลองเปลี่ยนตัวกรอง หรืออัปโหลดเอกสารใหม่
            </p>
            {adminTier && (
              <DfButton
                href="/docuflow/documents/upload/template"
                variant="brand"
              >
                <Upload size={14} />
                อัปโหลดเอกสาร
              </DfButton>
            )}
          </DfCard>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            {docs.map((d: CanonicalDocument) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
          </div>
        )}
      </DfSection>
    </div>
  );
}
