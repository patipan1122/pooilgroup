// DocuFlow — รายการเอกสารทั้งหมด
// ────────────────────────────────────────────────────────────────────
// Server component. Executive role guard. Reads canonical loader
// (lib/docuflow/data.ts — Agent A). Filters via searchParams.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { FileText, Upload } from "lucide-react";
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
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { thaiDateLong } from "@/lib/utils/format";
import { DocumentCard } from "@/components/docuflow/document-card";
import { DocumentFilters } from "@/components/docuflow/document-filters";

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
  /** Scope filters used by Mode 2 drilldown (BranchDocumentsSection) */
  branchId?: string;
  companyId?: string;
  businessType?: string;
  /** "1" → show only docs shared to branchId via document_shared_branches */
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

  // Load filtered docs + all tags (for filter UI).
  // When `shared=1` is set, the source is the cross-branch share table —
  // the loader skips the ownership filter and queries document_shared_branches.
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

  // Top tags (limit list — show 12 most common via simple alphabetical)
  const tagChips = allTags.slice(0, 12).map((t) => ({ value: t, label: `#${t}` }));

  // Scope label — shown when drilling in from a Branch/Company/Type page.
  // Lets the user understand they're looking at a subset, and clear it.
  const scopeLabel = (() => {
    if (sharedOnly && filterBranchId) return "เอกสารใช้ร่วมจากสาขาอื่น";
    if (filterBranchId) return "ขอบเขต: เอกสารของสาขา";
    if (filterCompanyId) return "ขอบเขต: เอกสารของบริษัท";
    if (filterBusinessType) return "ขอบเขต: เอกสารตามประเภทธุรกิจ";
    return null;
  })();
  // Build "clear scope" link — keeps tag/status/search/level
  const scopeClearParams = new URLSearchParams();
  if (filterLevel) scopeClearParams.set("level", filterLevel);
  if (filterTag) scopeClearParams.set("tag", filterTag);
  if (filterStatus) scopeClearParams.set("status", filterStatus);
  if (search) scopeClearParams.set("search", search);
  const scopeClearHref = scopeClearParams.toString()
    ? `/docuflow/documents?${scopeClearParams.toString()}`
    : "/docuflow/documents";

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          รายการ <span className="text-gradient-blue">เอกสารทั้งหมด</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          พบ <span className="font-bold text-zinc-900">{docs.length}</span>{" "}
          เอกสาร
        </p>
        {scopeLabel && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] px-3 py-1 text-xs">
            <span className="font-semibold text-[var(--color-brand-700)]">
              {scopeLabel}
            </span>
            <Link
              href={scopeClearHref}
              className="text-[var(--color-brand-700)] hover:underline font-medium"
            >
              ล้างขอบเขต
            </Link>
          </div>
        )}
      </header>

      <Section
        number="01"
        label="ตัวกรอง"
        title="กรองเอกสาร"
        className="mb-6 animate-fade-up delay-100"
        action={
          adminTier ? (
            <Link
              href="/docuflow/documents/upload/template"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl"
            >
              <Upload className="size-4" />
              อัปโหลดเอกสาร
            </Link>
          ) : undefined
        }
      >
        <Card>
          <CardBody className="space-y-4">
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
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
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
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
                <p className="text-xs font-bold text-zinc-500 mb-2">
                  Tag
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
          </CardBody>
        </Card>
      </Section>

      <Section
        number="02"
        label="เอกสาร"
        title="เอกสาร"
        className="animate-fade-up delay-200"
      >
        {docs.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ไม่พบเอกสารตามเงื่อนไข"
                description="ลองเปลี่ยนตัวกรอง หรืออัปโหลดเอกสารใหม่"
                action={
                  adminTier ? (
                    <Link
                      href="/docuflow/documents/upload/template"
                      className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] h-10 px-4 text-sm rounded-xl"
                    >
                      <Upload className="size-4" />
                      อัปโหลดเอกสาร
                    </Link>
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {docs.map((d: CanonicalDocument) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
