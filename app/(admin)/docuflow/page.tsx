// DocuFlow — overview / pyramid drill-down landing
// ────────────────────────────────────────────────────────────────────
// Server component. Executive role guard.
// Phase 1 redesign (2026-05-10): pyramid drill-down by ownership level
//   ?              → root: companies + "ทั้งกลุ่ม" tile
//   ?level=group   → list of group-level docs
//   ?level=company&id=COMPANY_ID            → business types within company
//   ?level=business_type&id=COMPANY_ID_TYPE → branches within company×type
//
// Spec: ดีเทลv1/DOCUFLOW.md §6 + plans/docuflow-deep-redesign.md
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FileText,
  Clock,
  Upload,
  ArrowUpRight,
  ChevronRight,
  Home,
  FolderTree,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocuments, loadRenewals } from "@/lib/docuflow/data";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong, bkkRelative } from "@/lib/utils/format";
import { ExpiryBadge } from "@/components/docuflow/expiry-badge";
import {
  PyramidCard,
  TotalsStrip,
} from "@/components/docuflow/pyramid-card";
import {
  aggregateRoot,
  aggregateCompany,
  aggregateBusinessType,
  businessTypeLabel,
} from "@/lib/docuflow/aggregations";
import type { BusinessType } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

interface SearchParams {
  level?: "group" | "company" | "business_type";
  id?: string;
}

export default async function DocuFlowOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const params = await searchParams;
  const level = params.level;
  const id = params.id;

  // ─── Decide which view to render ───
  if (level === "company" && id) {
    return (
      <CompanyView orgId={orgId} companyId={id} adminTier={adminTier} />
    );
  }

  if (level === "business_type" && id) {
    // id format: companyId_businessType
    const sep = id.lastIndexOf("_");
    if (sep > 0) {
      const companyId = id.slice(0, sep);
      const businessType = id.slice(sep + 1) as BusinessType;
      return (
        <BusinessTypeView
          orgId={orgId}
          companyId={companyId}
          businessType={businessType}
          adminTier={adminTier}
        />
      );
    }
    notFound();
  }

  if (level === "group") {
    return <GroupLevelView orgId={orgId} adminTier={adminTier} />;
  }

  return <RootView orgId={orgId} adminTier={adminTier} />;
}

/* ============================================================
   Breadcrumb
   ============================================================ */

function Breadcrumb({
  trail,
}: {
  trail: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-zinc-500 mb-3 flex-wrap">
      <Link
        href="/docuflow"
        className="inline-flex items-center gap-1 hover:text-[var(--color-brand-700)] transition-colors"
      >
        <Home className="size-3.5" />
        DocuFlow
      </Link>
      {trail.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <ChevronRight className="size-3.5 text-zinc-300" />
          {t.href ? (
            <Link
              href={t.href}
              className="hover:text-[var(--color-brand-700)] transition-colors"
            >
              {t.label}
            </Link>
          ) : (
            <span className="font-semibold text-zinc-700">{t.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ============================================================
   Header — uniform across all views
   ============================================================ */

function PageHeader({
  eyebrow,
  title,
  description,
  adminTier,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  adminTier: boolean;
}) {
  return (
    <header className="mb-6 animate-fade-up flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          {eyebrow}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[1.05]">
          {title}
        </h1>
        {description && (
          <p className="text-zinc-600 mt-1.5 text-sm">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/docuflow/browse"
          className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border-2 border-zinc-200 hover:border-zinc-300 active:bg-zinc-50 h-10 px-4 text-sm rounded-xl shrink-0"
        >
          <FolderTree className="size-4" />
          ดูทั้งหมดตามโครงสร้าง
        </Link>
        {adminTier && (
          <Link
            href="/docuflow/documents/upload/template"
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl shrink-0"
          >
            <Upload className="size-4" />
            อัปโหลดเอกสาร
          </Link>
        )}
      </div>
    </header>
  );
}

/* ============================================================
   ROOT VIEW — Group + Companies
   ============================================================ */

async function RootView({
  orgId,
  adminTier,
}: {
  orgId: string;
  adminTier: boolean;
}) {
  const [root, renewals, recent] = await Promise.all([
    aggregateRoot(orgId),
    loadRenewals(orgId, { withinDays: 90 }),
    loadDocuments(orgId, { limit: 8 }),
  ]);

  const cards = [
    ...(root.groupTile ? [root.groupTile] : []),
    ...root.companies,
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <PageHeader
        eyebrow={`📄 DocuFlow · ${thaiDateLong(new Date())}`}
        title={
          <>
            ภาพรวม <span className="text-gradient-blue">เอกสาร Pooilgroup</span>
          </>
        }
        description={
          <>
            {root.totals.total.toLocaleString("th-TH")} เอกสารใช้งาน
            {root.totals.expired + root.totals.critical > 0 && (
              <>
                {" · "}
                <span className="font-bold text-rose-700">
                  ต่ออายุด่วน {root.totals.expired + root.totals.critical}
                </span>
              </>
            )}
          </>
        }
        adminTier={adminTier}
      />

      <Section
        number="01"
        label="DRILL-DOWN"
        title="กดเปิดเข้าดูเอกสารแต่ละชั้น"
        description="เริ่มจากระดับกลุ่ม → บริษัท → ประเภทธุรกิจ → สาขา"
        className="mb-10 animate-fade-up delay-100"
      >
        <TotalsStrip
          total={root.totals.total}
          expired={root.totals.expired}
          critical={root.totals.critical}
          watch={root.totals.watch}
          noExpiry={root.totals.noExpiry}
        />

        {cards.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีเอกสารในระบบ"
                description={
                  adminTier
                    ? "เริ่มจากอัปโหลดเอกสารแรก"
                    : "รอ Admin อัปโหลดเอกสารเข้าระบบ"
                }
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((node) => (
              <PyramidCard key={node.key} node={node} />
            ))}
          </div>
        )}
      </Section>

      <ExpiringSection renewals={renewals} />
      <RecentSection recent={recent} adminTier={adminTier} />
    </div>
  );
}

/* ============================================================
   COMPANY VIEW — business types within a company
   ============================================================ */

async function CompanyView({
  orgId,
  companyId,
  adminTier,
}: {
  orgId: string;
  companyId: string;
  adminTier: boolean;
}) {
  const view = await aggregateCompany(orgId, companyId);
  if (!view) notFound();

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <Breadcrumb trail={[{ label: view.company.name }]} />

      <PageHeader
        eyebrow={`🏢 ${view.company.code}`}
        title={
          <>
            <span className="text-gradient-blue">{view.company.name}</span>
          </>
        }
        description={
          <>
            แบ่งตามประเภทธุรกิจ — กดเข้าไปดูสาขาในประเภทนั้น
          </>
        }
        adminTier={adminTier}
      />

      <Section
        number="02"
        label="BUSINESS TYPES"
        title={`ประเภทธุรกิจของ ${view.company.name}`}
        description={`${view.businessTypes.length} ประเภท · เอกสารรวม ${view.totals.total.toLocaleString("th-TH")} ฉบับ`}
        className="mb-10 animate-fade-up delay-100"
      >
        <TotalsStrip
          total={view.totals.total}
          expired={view.totals.expired}
          critical={view.totals.critical}
          watch={view.totals.watch}
          noExpiry={view.totals.noExpiry}
        />

        {view.directStats.total > 0 && (
          <div className="mb-4 rounded-xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-[var(--color-brand-100)] border-2 border-[var(--color-brand-200)] flex items-center justify-center text-lg">
              🏢
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900">
                เอกสารระดับบริษัทโดยตรง
              </p>
              <p className="text-xs text-zinc-600">
                {view.directStats.total.toLocaleString("th-TH")} ฉบับ — ไม่อิงสาขาเฉพาะเจาะจง
              </p>
            </div>
            <Link
              href={`/docuflow/documents?level=company&companyId=${view.company.id}`}
              className="text-sm font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center gap-1"
            >
              ดูรายการ
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        )}

        {view.businessTypes.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีประเภทธุรกิจที่มีสาขา"
                description="ต้องสร้างสาขาในบริษัทนี้ก่อน"
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {view.businessTypes.map((node) => (
              <PyramidCard key={node.key} node={node} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
   BUSINESS TYPE VIEW — branches within (company × business_type)
   ============================================================ */

async function BusinessTypeView({
  orgId,
  companyId,
  businessType,
  adminTier,
}: {
  orgId: string;
  companyId: string;
  businessType: BusinessType;
  adminTier: boolean;
}) {
  const view = await aggregateBusinessType(orgId, companyId, businessType);
  if (!view) notFound();

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <Breadcrumb
        trail={[
          {
            label: view.company.name,
            href: `/docuflow?level=company&id=${view.company.id}`,
          },
          { label: view.businessTypeLabel },
        ]}
      />

      <PageHeader
        eyebrow={`${view.businessTypeEmoji} ${view.company.code} · ${businessTypeLabel(businessType)}`}
        title={
          <>
            <span className="text-gradient-blue">
              {view.businessTypeLabel}
            </span>
            <span className="text-zinc-400"> · </span>
            <span className="text-zinc-700">{view.company.name}</span>
          </>
        }
        description={`${view.branches.length} สาขา · เอกสารรวม ${view.totals.total.toLocaleString("th-TH")} ฉบับ`}
        adminTier={adminTier}
      />

      <Section
        number="03"
        label="BRANCHES"
        title="สาขาในประเภทธุรกิจนี้"
        description="กดสาขาเพื่อดูรายการเอกสารทั้งหมด"
        className="mb-10 animate-fade-up delay-100"
      >
        <TotalsStrip
          total={view.totals.total}
          expired={view.totals.expired}
          critical={view.totals.critical}
          watch={view.totals.watch}
          noExpiry={view.totals.noExpiry}
        />

        {view.directStats.total > 0 && (
          <div className="mb-4 rounded-xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-[var(--color-brand-100)] border-2 border-[var(--color-brand-200)] flex items-center justify-center text-lg">
              {view.businessTypeEmoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900">
                เอกสารระดับประเภทธุรกิจ
              </p>
              <p className="text-xs text-zinc-600">
                {view.directStats.total.toLocaleString("th-TH")} ฉบับ — ใช้ได้ทุกสาขาประเภทนี้
              </p>
            </div>
            <Link
              href={`/docuflow/documents?level=business_type&businessType=${businessType}`}
              className="text-sm font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] inline-flex items-center gap-1"
            >
              ดูรายการ
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        )}

        {view.branches.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีสาขาในประเภทนี้"
                description="ต้องสร้างสาขาก่อน"
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {view.branches.map((node) => (
              <PyramidCard key={node.key} node={node} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
   GROUP-LEVEL VIEW — list of docs at level='group'
   ============================================================ */

async function GroupLevelView({
  orgId,
  adminTier,
}: {
  orgId: string;
  adminTier: boolean;
}) {
  const docs = await loadDocuments(orgId, { level: "group", limit: 200 });

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <Breadcrumb trail={[{ label: "ทั้งกลุ่ม" }]} />

      <PageHeader
        eyebrow="🌐 ทั้งกลุ่ม"
        title={
          <>
            <span className="text-gradient-blue">เอกสารระดับกลุ่ม</span>
          </>
        }
        description={`${docs.length} ฉบับ — ใช้ร่วมกันทั้ง Pooilgroup`}
        adminTier={adminTier}
      />

      <Section
        number="GR"
        label="GROUP DOCS"
        title="เอกสารทั้งกลุ่ม"
        description="เอกสารที่อ้างอิงระดับ Pooilgroup ไม่ผูกบริษัทใดบริษัทหนึ่ง"
        className="mb-10 animate-fade-up delay-100"
      >
        {docs.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<FileText className="size-6" />}
                title="ยังไม่มีเอกสารระดับกลุ่ม"
                description="เอกสารระดับกลุ่มเช่น นโยบายบริษัท · มาตรฐาน ESG · จรรยาบรรณ"
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-zinc-100">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
                >
                  <div className="size-9 shrink-0 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
                    <FileText className="size-4" />
                  </div>
                  <Link
                    href={`/docuflow/documents/${d.id}`}
                    className="flex-1 min-w-0 group"
                  >
                    <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                      {d.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                      <span>{bkkRelative(d.uploadedAt)}</span>
                      {d.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="truncate">
                            {d.tags.slice(0, 3).join(" · ")}
                          </span>
                        </>
                      )}
                    </div>
                  </Link>
                  {d.renewal ? (
                    <ExpiryBadge
                      status={d.renewal.expiryStatus}
                      days={d.renewal.daysUntilExpiry}
                    />
                  ) : (
                    <Badge tone="neutral">ไม่มีวันหมดอายุ</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
   Shared "Expiring" + "Recent" sections (root view only)
   ============================================================ */

function ExpiringSection({
  renewals,
}: {
  renewals: Awaited<ReturnType<typeof loadRenewals>>;
}) {
  return (
    <Section
      number="02"
      label="EXPIRING"
      title="ใกล้หมดอายุที่สุด"
      description="10 รายการแรกที่ต้องต่ออายุก่อน"
      className="mb-10 animate-fade-up delay-200"
      action={
        <Link
          href="/docuflow/expiry"
          className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-10 px-4 text-sm rounded-xl"
        >
          ดูทั้งหมด
          <ArrowUpRight className="size-4" />
        </Link>
      }
    >
      {renewals.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Clock className="size-6" />}
              title="ยังไม่มีเอกสารที่ใกล้หมดอายุ"
              description="ทุกเอกสารยังมีอายุเหลือเกิน 90 วัน"
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-100">
            {renewals.slice(0, 10).map((r) => (
              <li
                key={r.id}
                className="px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
              >
                <ExpiryBadge
                  status={r.expiryStatus}
                  days={r.daysUntilExpiry}
                />
                <Link
                  href={`/docuflow/documents/${r.document.id}`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                    {r.document.name}
                  </p>
                  {r.notes && (
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {r.notes}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function RecentSection({
  recent,
  adminTier,
}: {
  recent: Awaited<ReturnType<typeof loadDocuments>>;
  adminTier: boolean;
}) {
  return (
    <Section
      number="03"
      label="RECENT"
      title="อัปโหลดล่าสุด"
      description="ไฟล์ที่เพิ่มเข้าระบบล่าสุด"
      className="animate-fade-up delay-300"
    >
      {recent.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<FileText className="size-6" />}
              title="ยังไม่มีเอกสารในระบบ"
              description={
                adminTier
                  ? "เริ่มจากอัปโหลดเอกสารแรก"
                  : "รอ Admin อัปโหลดเอกสารเข้าระบบ"
              }
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
        <Card>
          <ul className="divide-y divide-zinc-100">
            {recent.map((d) => (
              <li
                key={d.id}
                className="px-4 py-3 sm:px-5 sm:py-4 flex items-center gap-3 hover:bg-zinc-50/60 transition-colors"
              >
                <div className="size-9 shrink-0 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
                  <FileText className="size-4" />
                </div>
                <Link
                  href={`/docuflow/documents/${d.id}`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="font-medium text-zinc-900 truncate group-hover:text-[var(--color-brand-700)] transition-colors">
                    {d.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                    <span>{bkkRelative(d.uploadedAt)}</span>
                    {d.tags.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="truncate">
                          {d.tags.slice(0, 3).join(" · ")}
                        </span>
                      </>
                    )}
                  </div>
                </Link>
                {d.renewal ? (
                  <ExpiryBadge
                    status={d.renewal.expiryStatus}
                    days={d.renewal.daysUntilExpiry}
                  />
                ) : (
                  <Badge tone="neutral">ไม่มีวันหมดอายุ</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
