// DocuFlow — รายการเอกสารทั้งหมด (advanced filter)
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — canvas-aligned chrome + DfPill filters.
// Docuflow redesign 2026-09-23 — canonical merge of /docuflow/browse into
// this page: `?view=` now drives 3 real views (ตามประเภท / ตามบริษัท /
// รายการ) via a `.df-seg` tab control. /docuflow/browse is now a thin
// redirect stub that forwards here (preserving `?tag=` etc.) — see
// app/(admin)/docuflow/browse/page.tsx.
// Data source unchanged.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  FileText,
  Upload,
  Filter,
  Sparkles,
  Scale,
  Wallet,
  Shield,
  Fuel,
  Car,
  TreePine,
  Stamp,
  Settings,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin, requireModuleView } from "@/lib/auth/module-access";
import { resolveCompanyFilter, loadCompaniesForOrg } from "@/lib/auth/company-context";
import {
  loadDocuments,
  loadDocumentsSharedToBranch,
  loadDocumentTags,
  type CanonicalDocument,
} from "@/lib/docuflow/data";
import { listDocumentTypes } from "@/lib/docuflow/document-types";
import { listDocumentGroups } from "@/lib/docuflow/document-groups";
import type { ExpiryStatus } from "@/lib/docuflow/expiry";
import { buildDocumentTree } from "@/lib/docuflow/tree";
import { DocumentCard } from "@/components/docuflow/document-card";
import { DocumentFilterSelect } from "@/components/docuflow/document-filter-select";
import { DocumentViewTabs } from "@/components/docuflow/document-view-tabs";
import {
  DocumentSortTabs,
  type DocumentSortValue,
} from "@/components/docuflow/document-sort-tabs";
import { TreeBrowser } from "@/components/docuflow/tree-browser";
import { QuickCreateDocumentGroupButton } from "@/components/docuflow/quick-create-document-group-button";
import { DocumentSearchInput } from "@/components/docuflow/document-search-input";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

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

// View tabs — "" (รายการ) is the default/fallback view so it's omitted from
// the URL, matching the `current === ""` = "all" convention DocumentFilters
// already uses for its chip rows.
const VIEW_OPTIONS = [
  { value: "category", label: "ตามประเภท" },
  { value: "tree", label: "ตามบริษัท" },
  { value: "", label: "รายการ" },
];

// Ported from the old /docuflow/browse — tile grid that drills into a
// real `/docuflow/documents?tag=...` filter. tag === category name → seed
// data uses the category name as the canonical filter tag, so clicking a
// tile lands on a populated result set.
const CATEGORIES: Array<{
  id: string;
  name: string;
  color: string;
  icon: React.ReactNode;
  bucket: "keep" | "signoff";
  tag: string;
}> = [
  { id: "legal", name: "เอกสารนิติบุคคล", color: "var(--df-brand)", icon: <Scale size={20} />, bucket: "keep", tag: "เอกสารนิติบุคคล" },
  { id: "tax", name: "ภาษี & การเงิน", color: "#15803D", icon: <Wallet size={20} />, bucket: "keep", tag: "ภาษี & การเงิน" },
  { id: "insurance", name: "ประกัน", color: "#7C3AED", icon: <Shield size={20} />, bucket: "keep", tag: "ประกัน" },
  { id: "station", name: "เอกสารปั๊ม / สถานี", color: "#C46A3D", icon: <Fuel size={20} />, bucket: "keep", tag: "เอกสารปั๊ม / สถานี" },
  { id: "vehicle", name: "ทะเบียนรถ", color: "#0EA5A4", icon: <Car size={20} />, bucket: "keep", tag: "ทะเบียนรถ" },
  { id: "land", name: "ที่ดิน · สัญญาที่ดิน", color: "#B45309", icon: <TreePine size={20} />, bucket: "keep", tag: "ที่ดิน · สัญญาที่ดิน" },
  { id: "contract", name: "สัญญา", color: "var(--df-brand-deep)", icon: <FileText size={20} />, bucket: "keep", tag: "สัญญา" },
  { id: "signoff", name: "เซ็นทิ้ง · ไม่เก็บ", color: "var(--df-muted)", icon: <Stamp size={20} />, bucket: "signoff", tag: "เซ็นทิ้ง · ไม่เก็บ" },
];

interface SP {
  view?: string;
  level?: string;
  tag?: string;
  status?: string;
  search?: string;
  branchId?: string;
  /** Opt-in exact-match narrowing (ownership.companyId) — used by a few
   *  existing deep links (branch-documents-section.tsx's "เอกสารจากบริษัท"
   *  card, usually paired with level=company). NOT the page's default
   *  scope — see `company` below for that. */
  companyId?: string;
  businessType?: string;
  documentTypeId?: string;
  shared?: string;
  /** List-view sort (CEO Pinpoint item #11, 2026-10-13) — "newest" is the
   *  default/fallback so it's omitted from the URL, same convention as
   *  `view`'s "" default above. */
  sort?: string;
  /** Global company-switcher param (lib/auth/company-context.ts) — the
   *  SINGLE source of truth for which company's documents this page shows
   *  by default. Company-switcher scoping Phase 3, 2026-10-11. */
  company?: string;
}

export default async function DocumentsListPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  await requireModuleView(session.user, "docuflow");
  const sp = await searchParams;
  const orgId = session.user.org_id;
  const adminTier = await userIsModuleAdmin(session.user, "docuflow");

  const rawView = sp.view || "";
  const view: "category" | "tree" | "list" =
    rawView === "category" || rawView === "tree" ? rawView : "list";

  const filterLevel = sp.level || "";
  const filterTag = sp.tag || "";
  const filterStatus = (sp.status || "") as ExpiryStatus | "";
  const search = sp.search || "";
  const filterBranchId = sp.branchId || "";
  const filterCompanyId = sp.companyId || "";
  const filterBusinessType = sp.businessType || "";
  const filterDocumentTypeId = sp.documentTypeId || "";
  const sharedOnly = sp.shared === "1";
  const sort: DocumentSortValue =
    sp.sort === "oldest" || sp.sort === "name_asc" ? sp.sort : "newest";

  // Company-switcher scoping Phase 3 (2026-10-11) — the global switcher's
  // ?company=/cookie selection is now the SINGLE source of truth for which
  // company's documents this page shows by default (previously `companyId`
  // above was the only company signal, and it was a fully opt-in filter the
  // page defaulted to "all companies mixed" without). `companyId` stays as
  // an exact-match narrowing filter for the existing deep links that pass
  // it (branch-documents-section.tsx), it just no longer drives the default
  // scope — see lib/docuflow/data.ts's `visibleToCompanyId` doc comment.
  const companyId = await resolveCompanyFilter(orgId, sp.company);
  // CEO Pinpoint item #1 (2026-10-13) — the top-level "สร้างกลุ่มเอกสาร"
  // quick-create button needs to know which company to scope the new
  // folder to (see quick-create-document-group-button.tsx). Cheap/cached
  // (loadCompaniesForOrg already backs resolveCompanyFilter above).
  const allCompanies = await loadCompaniesForOrg(orgId);
  const currentCompanyName =
    allCompanies.find((c) => c.id === companyId)?.name ?? "";

  const [docs, allTags, docTypes, tree, documentGroups] = await Promise.all([
    sharedOnly && filterBranchId
      ? loadDocumentsSharedToBranch(orgId, filterBranchId, { limit: 200 })
      : loadDocuments(orgId, {
          level: filterLevel || undefined,
          branchId: filterBranchId || undefined,
          companyId: filterCompanyId || undefined,
          businessType: filterBusinessType || undefined,
          tag: filterTag || undefined,
          documentTypeId: filterDocumentTypeId || undefined,
          expiryStatus: filterStatus || undefined,
          search: search || undefined,
          limit: 200,
          visibleToCompanyId: companyId || undefined,
          sort,
        }),
    loadDocumentTags(orgId),
    listDocumentTypes(orgId, companyId || undefined),
    view === "tree" ? buildDocumentTree(orgId, companyId || undefined) : Promise.resolve(null),
    listDocumentGroups(orgId),
  ]);

  const preserve: Record<string, string> = {};
  if (filterLevel) preserve.level = filterLevel;
  if (filterTag) preserve.tag = filterTag;
  if (filterStatus) preserve.status = filterStatus;
  if (search) preserve.search = search;
  if (filterBranchId) preserve.branchId = filterBranchId;
  if (filterCompanyId) preserve.companyId = filterCompanyId;
  if (filterBusinessType) preserve.businessType = filterBusinessType;
  if (filterDocumentTypeId) preserve.documentTypeId = filterDocumentTypeId;
  if (sharedOnly) preserve.shared = "1";
  if (sp.company) preserve.company = sp.company;
  if (sort !== "newest") preserve.sort = sort;

  const tagChips = allTags.slice(0, 12).map((t) => ({ value: t, label: `#${t}` }));
  const docTypeChips = docTypes.map((dt) => ({ value: dt.id, label: dt.name }));

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
  if (filterDocumentTypeId) scopeClearParams.set("documentTypeId", filterDocumentTypeId);
  if (search) scopeClearParams.set("search", search);
  if (view !== "list") scopeClearParams.set("view", view);
  const scopeClearHref = scopeClearParams.toString()
    ? `/docuflow/documents?${scopeClearParams.toString()}`
    : "/docuflow/documents";

  const activeFilterCount =
    (search ? 1 : 0) +
    (filterLevel ? 1 : 0) +
    (filterStatus ? 1 : 0) +
    (filterTag ? 1 : 0) +
    (filterBranchId ? 1 : 0) +
    (filterCompanyId ? 1 : 0) +
    (filterBusinessType ? 1 : 0) +
    (filterDocumentTypeId ? 1 : 0);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "เอกสาร · ค้นหา" }]} />

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
          ) : view === "category" ? (
            "เลือกประเภทเอกสารเพื่อดูรายการที่กรองแล้ว"
          ) : view === "tree" ? (
            "เลือกประเภทธุรกิจ/สาขาเพื่อดูเอกสารตามโครงสร้างองค์กร (บริษัทเลือกจากเมนูด้านบน)"
          ) : (
            "ใช้ตัวกรองด้านล่างเพื่อค้นหาเอกสารตามระดับ/สถานะ/ประเภท/แท็ก (บริษัทเลือกจากเมนูด้านบน)"
          )
        }
        actions={
          <>
            <DocumentViewTabs
              current={view === "list" ? "" : view}
              options={VIEW_OPTIONS}
              preserve={preserve}
            />
            <DfButton href="/docuflow/search" variant="ghost">
              <Sparkles size={15} />
              ถาม AI
            </DfButton>
            {/* CEO click-report item 3 (2026-10-10): the quick-create
                DocumentGroup dialog already existed inside the upload form,
                but was only reachable from there — mounted here too, same
                dialog + same API call (see quick-create-document-group-button.tsx). */}
            {adminTier && (
              <QuickCreateDocumentGroupButton
                companyId={companyId}
                companyName={currentCompanyName}
              />
            )}
            {/* CEO click-report item 4 (2026-09-30): "ตั้งค่าประเภทเอกสาร" was
                only reachable by scrolling to the bottom of the category grid
                below, then landing on the settings HUB (an extra hop before
                reaching the actual document-types settings page). This puts
                a direct shortcut in the toolbar, visible without scrolling,
                only in the ตามประเภท (category) view where it's relevant. */}
            {adminTier && view === "category" ? (
              <DfButton href="/docuflow/settings/document-types" variant="ghost">
                <Settings size={15} />
                ตั้งค่าประเภทเอกสาร
              </DfButton>
            ) : null}
            {adminTier ? (
              <DfButton
                href="/docuflow/documents/upload/template"
                variant="brand"
              >
                <Upload size={15} />
                อัปโหลดเอกสาร
              </DfButton>
            ) : null}
          </>
        }
      />

      {view === "category" && (
        <DfSection
          number="01"
          label="ประเภทเอกสาร"
          className="df-fade-up df-fade-up-100"
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {CATEGORIES.map((c) => (
              <Link
                key={c.id}
                href={`/docuflow/documents?tag=${encodeURIComponent(c.tag)}`}
                className="df-card"
                style={{
                  padding: 16,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: c.color + "18",
                      color: c.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {c.icon}
                  </span>
                  {c.bucket === "signoff" && (
                    <DfPill tone="outline" small>
                      เซ็นทิ้ง
                    </DfPill>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--df-ink)",
                    marginBottom: 4,
                  }}
                >
                  {c.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--df-muted)" }}>
                  ใช้ filter
                </div>
              </Link>
            ))}
            {adminTier && (
              <Link
                href="/docuflow/settings/document-types"
                style={{
                  padding: 16,
                  borderRadius: 18,
                  border: "1.5px dashed var(--df-line)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--df-muted)",
                  minHeight: 138,
                  textDecoration: "none",
                  background: "transparent",
                }}
              >
                <Settings size={20} />
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>
                  ตั้งค่าประเภทเอกสาร
                </div>
              </Link>
            )}
          </div>
        </DfSection>
      )}

      {view === "tree" && tree && (
        <DfSection
          number="01"
          label="เอกสารตามบริษัท / สาขา"
          className="df-fade-up df-fade-up-100"
        >
          <DfCard padding={0} style={{ overflow: "hidden" }}>
            <TreeBrowser tree={tree} adminTier={adminTier} />
          </DfCard>
        </DfSection>
      )}

      {view === "list" && (
        <>
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
            <DfCard padding={16}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                }}
              >
                {/* The "บริษัท" filter dropdown that used to live here was
                    removed (Company-switcher scoping Phase 3, 2026-10-11) —
                    it was a SECOND, independent "which company" control
                    that could disagree with the header switcher pill. The
                    header switcher is now the only company control on this
                    page; `filterCompanyId`/`?companyId=` still works as a
                    narrowing filter for the handful of existing deep links
                    that set it (see the SP interface comment above), it
                    just has no UI entry point of its own anymore. */}
                <DocumentSearchInput
                  current={search}
                  preserve={(() => {
                    const p = { ...preserve };
                    delete p.search;
                    return p;
                  })()}
                />
                <DocumentFilterSelect
                  label="ระดับ"
                  paramKey="level"
                  current={filterLevel}
                  options={LEVEL_CHIPS}
                  preserve={(() => {
                    const p = { ...preserve };
                    delete p.level;
                    return p;
                  })()}
                />
                <DocumentFilterSelect
                  label="สถานะวันหมดอายุ"
                  paramKey="status"
                  current={filterStatus}
                  options={EXPIRY_CHIPS}
                  preserve={(() => {
                    const p = { ...preserve };
                    delete p.status;
                    return p;
                  })()}
                />
                {docTypeChips.length > 0 && (
                  <DocumentFilterSelect
                    label="ประเภทเอกสาร"
                    paramKey="documentTypeId"
                    current={filterDocumentTypeId}
                    options={docTypeChips}
                    preserve={(() => {
                      const p = { ...preserve };
                      delete p.documentTypeId;
                      return p;
                    })()}
                  />
                )}
                {tagChips.length > 0 && (
                  <DocumentFilterSelect
                    label="แท็ก"
                    paramKey="tag"
                    current={filterTag}
                    options={tagChips}
                    preserve={(() => {
                      const p = { ...preserve };
                      delete p.tag;
                      return p;
                    })()}
                  />
                )}
              </div>
            </DfCard>
          </DfSection>

          <DfSection
            number="02"
            label={`เอกสาร · ${docs.length} รายการ`}
            action={
              docs.length > 0 ? (
                <DocumentSortTabs
                  current={sort}
                  preserve={(() => {
                    const p = { ...preserve };
                    delete p.sort;
                    return p;
                  })()}
                />
              ) : null
            }
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
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    groups={documentGroups}
                    canMove={adminTier}
                  />
                ))}
              </div>
            )}
          </DfSection>
        </>
      )}
    </div>
  );
}
