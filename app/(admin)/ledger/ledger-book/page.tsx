// "สมุดค่าใช้จ่าย" — spend book.
//
// Two modes (gated by LEDGER_ANALYTICS_V1, byte-equivalent when OFF):
//   • FLAG OFF (today's behaviour): one card per active category → its latest-
//     month total + a 6-month sparkline, tapping to /ledger/categories/[id].
//   • FLAG ON (workshop 2026-06-07): the faceted spend-analytics pivot — the
//     CEO's hand-kept "ค่าน้ำ ค่าไฟ" sheet, automated. Pick a หมวด → rows = สาขา
//     × cols = เดือน + totals; tick filters (axis/หมวด/grain/ก่อน-รวม VAT); a
//     keyword search ("น้ำแข็ง") → last buys + unit price ("ล่าสุดซื้อกี่บาท").
//
// Scope: org+company ALWAYS (companyId mandatory — one org = many legal entities).
// A scoped LINE member only totals their own branches; admin/accountant company-
// wide. Real spend only (confirmed+locked, non-superseded).
import Link from "next/link";
import { BookOpen, ChevronRight, ArrowLeft, Receipt } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { categoryBookIndex } from "@/lib/ledger/category-ledger";
import {
  spendPivot,
  searchPurchases,
  type RowAxis,
  type TimeGrain,
  type AmountBasis,
} from "@/lib/ledger/spend-analytics";
import { ledgerAnalyticsV1 } from "@/lib/ledger/flags";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { resolveScope, type LedgerScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { Sparkline, TrendChart } from "../categories/_components/TrendChart";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { AnalyticsControls } from "./_components/AnalyticsControls";
import { PivotTable } from "./_components/PivotTable";

export const dynamic = "force-dynamic";

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function monthLabel(period: string | null): string {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS[m - 1] ?? period} ${(y + 543) % 100}`;
}
function dayLabel(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  if (!m || !day) return d;
  return `${day} ${TH_MONTHS[m - 1] ?? ""} ${(y + 543) % 100}`;
}

const AXES: ReadonlyArray<RowAxis> = ["branch", "category", "vendor", "person"];
function parseAxis(v: string | undefined): RowAxis | null {
  return v && (AXES as readonly string[]).includes(v) ? (v as RowAxis) : null;
}

interface LedgerBookSearchParams {
  company?: string;
  branch?: string;
  ax?: string;
  cat?: string;
  grain?: string;
  basis?: string;
  q?: string;
}

export default async function LedgerBookPage({
  searchParams,
}: {
  searchParams: Promise<LedgerBookSearchParams>;
}) {
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
  );
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <LedgerHeader title="สมุดค่าใช้จ่าย" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const actor = await resolveLedgerActor();
  const actorScope = {
    allBranches: actor?.allBranches ?? true,
    scopeBranchIds: actor?.scopeBranchIds ?? [],
  };

  // FLAG OFF → today's category-card index (unchanged).
  if (!ledgerAnalyticsV1()) {
    return <BookIndex scope={scope} sp={sp} actorScope={actorScope} />;
  }

  // FLAG ON → faceted spend-analytics.
  const baseParams = new URLSearchParams();
  if (sp.company) baseParams.set("company", sp.company);
  if (sp.branch) baseParams.set("branch", sp.branch);
  const baseQs = baseParams.toString();

  const categoryId = sp.cat || null;
  const grain: TimeGrain = sp.grain === "year" ? "year" : "month";
  const basis: AmountBasis = sp.basis === "gross" ? "gross" : "net";
  const search = (sp.q ?? "").trim();
  // Default axis: a chosen category → branch breakdown (the CEO's sheet); else a
  // category overview. Explicit ?ax always wins.
  const axis: RowAxis = parseAxis(sp.ax) ?? (categoryId ? "branch" : "category");
  const branchFilter = scope.branchId; // header branch picker = the branch facet

  const categories = await prisma.ledgerCategory.findMany({
    where: { orgId: scope.orgId, companyId: scope.companyId, active: true },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  return (
    <div className="p-4 sm:p-6 pb-24 lg:pb-6">
      <LedgerHeader
        title="สมุดค่าใช้จ่าย"
        subtitle="ดูค่าใช้จ่ายย้อนหลัง · เทียบเดือน/ปี · ตามหมวด/สาขา/ผู้ขาย"
        scope={scope}
      />

      <AnalyticsControls
        axis={axis}
        categoryId={categoryId}
        grain={grain}
        basis={basis}
        search={search}
        categories={categories}
      />

      {search ? (
        <SearchResults
          orgId={scope.orgId}
          companyId={scope.companyId}
          actorScope={actorScope}
          term={search}
          branchId={branchFilter}
          basis={basis}
          baseQs={baseQs}
        />
      ) : (
        <PivotSection
          orgId={scope.orgId}
          companyId={scope.companyId}
          actorScope={actorScope}
          axis={axis}
          categoryId={categoryId}
          branchId={branchFilter}
          grain={grain}
          basis={basis}
          baseQs={baseQs}
        />
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-400">
        นับเฉพาะใบที่ยืนยันแล้ว (ไม่รวมร่าง · ไม่นับใบที่ถูกแทนที่) · ยอด
        {basis === "net" ? "ก่อน VAT" : "รวม VAT"} · เฉพาะบริษัทที่เลือก
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// FLAG ON · pivot section (server-computed → handed to the client PivotTable)
// --------------------------------------------------------------------------
async function PivotSection({
  orgId, companyId, actorScope, axis, categoryId, branchId, grain, basis, baseQs,
}: {
  orgId: string;
  companyId: string;
  actorScope: { allBranches: boolean; scopeBranchIds: string[] };
  axis: RowAxis;
  categoryId: string | null;
  branchId: string | null;
  grain: TimeGrain;
  basis: AmountBasis;
  baseQs: string;
}) {
  const pivot = await spendPivot({
    orgId,
    companyId,
    actorScope,
    rowAxis: axis,
    categoryId,
    branchId,
    grain,
    span: grain === "year" ? 3 : 12,
    anchorPeriod: currentPeriodBangkok(),
    basis,
  });

  return (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-800">
          {grain === "year" ? "เทียบรายปี" : "ย้อนหลังรายเดือน"}
        </h2>
        <span className="text-sm font-bold tabular-nums text-zinc-900">
          รวม {baht(pivot.grandTotal)}
        </span>
      </div>
      {grain === "year" && (
        <p className="mb-2 text-[11px] text-amber-600">
          * ปีปัจจุบันยังไม่ครบปี — เทียบยอดสะสมถึงเดือนล่าสุดเท่านั้น
        </p>
      )}
      <PivotTable pivot={pivot} axis={axis} categoryId={categoryId} baseQs={baseQs} />
    </>
  );
}

// --------------------------------------------------------------------------
// FLAG ON · keyword search results ("ล่าสุดซื้อ X กี่บาท")
// --------------------------------------------------------------------------
async function SearchResults({
  orgId, companyId, actorScope, term, branchId, basis, baseQs,
}: {
  orgId: string;
  companyId: string;
  actorScope: { allBranches: boolean; scopeBranchIds: string[] };
  term: string;
  branchId: string | null;
  basis: AmountBasis;
  baseQs: string;
}) {
  const res = await searchPurchases({
    orgId, companyId, actorScope, term, branchId, basis, limit: 12,
  });

  if (res.hits.length === 0) {
    return (
      <LedgerEmptyState
        className="min-h-[30vh]"
        mascotSize={64}
        title={`ไม่พบรายการที่ตรงกับ "${term}"`}
        hint="ค้นจากชื่อรายการในบิล + ชื่อผู้ขาย — บางใบที่ OCR อ่านชื่อไม่เจออาจไม่ขึ้น"
      />
    );
  }

  const total = res.trend.reduce((a, t) => a + t.total, 0);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-800">
          ประวัติ &ldquo;{term}&rdquo; · {res.hits.length} ครั้งล่าสุด
        </h2>
        <span className="text-sm font-bold tabular-nums text-zinc-900">รวม {baht(total)}</span>
      </div>

      {res.trend.length > 1 && (
        <div className="mb-3">
          <TrendChart points={res.trend} />
        </div>
      )}

      <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
        {res.hits.map((h) => (
          <li key={h.id}>
            <Link
              href={`/ledger/expenses?${baseQs}${baseQs ? "&" : ""}selected=${h.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-800">
                  {h.itemDescription || h.vendor || "ไม่ระบุ"}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
                  <span>{dayLabel(h.docDate)}</span>
                  {h.vendor && <span>· {h.vendor}</span>}
                  {h.branchName && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500">{h.branchName}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {h.itemUnitPrice != null && h.itemUnitPrice > 0 ? (
                  <>
                    <span className="block text-sm font-bold tabular-nums text-zinc-900">
                      {baht(h.itemUnitPrice)}
                    </span>
                    <span className="block text-[11px] text-zinc-400">/หน่วย · ใบ {baht(h.amount)}</span>
                  </>
                ) : (
                  <span className="block text-sm font-bold tabular-nums text-zinc-900">{baht(h.amount)}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
        <Receipt className="size-3.5" aria-hidden /> แตะรายการเพื่อเปิดใบจริง
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// FLAG OFF · today's category-card index (unchanged behaviour)
// --------------------------------------------------------------------------
async function BookIndex({
  scope, sp, actorScope,
}: {
  scope: LedgerScope;
  sp: LedgerBookSearchParams;
  actorScope: { allBranches: boolean; scopeBranchIds: string[] };
}) {
  const entries = await categoryBookIndex({
    orgId: scope.orgId,
    companyId: scope.companyId!,
    actorScope,
    months: 6,
    anchorPeriod: currentPeriodBangkok(),
  });

  const linkParams = new URLSearchParams();
  if (sp.company) linkParams.set("company", sp.company);
  if (sp.branch) linkParams.set("branch", sp.branch);
  const linkSuffix = linkParams.toString() ? `?${linkParams.toString()}` : "";

  const sorted = [...entries].sort((a, b) => {
    if (b.latestTotal !== a.latestTotal) return b.latestTotal - a.latestTotal;
    return a.categoryName.localeCompare(b.categoryName, "th");
  });

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="สมุดค่าใช้จ่าย"
        subtitle="ดูค่าใช้จ่ายแต่ละหมวดย้อนหลัง · ความเปลี่ยนแปลงรายเดือน"
        scope={scope}
      />

      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[var(--color-brand-600)] ring-1 ring-blue-100">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <p className="text-sm text-zinc-600">
          แตะหมวดเพื่อเปิดเล่ม — ดูยอดรายเดือนย้อนหลังและกราฟแนวโน้มของหมวดนั้น
        </p>
      </div>

      {sorted.length === 0 ? (
        <LedgerEmptyState
          className="min-h-[40vh]"
          mascotSize={72}
          title="ยังไม่มีหมวดค่าใช้จ่าย"
          hint="เพิ่มหมวดในหน้าตั้งค่า แล้วยอดแต่ละหมวดจะมาเรียงเป็นเล่มที่นี่"
          action={
            <Link
              href="/ledger/settings"
              className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ไปหน้าตั้งค่า →
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((e) => (
            <li key={e.categoryId}>
              <Link
                href={`/ledger/categories/${e.categoryId}${linkSuffix}`}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-all hover:border-[var(--color-brand-200)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-400)]"
              >
                <span
                  className="size-3 shrink-0 rounded-full ring-1 ring-zinc-200"
                  style={{ background: e.color ?? "var(--color-brand-400)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-800">
                      {e.categoryName}
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
                      {baht(e.latestTotal)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      {e.latestPeriod ? `ล่าสุด ${monthLabel(e.latestPeriod)}` : "ยังไม่มีค่าใช้จ่าย"}
                    </span>
                    <Sparkline values={e.spark} className="h-6 w-20" />
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-zinc-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
