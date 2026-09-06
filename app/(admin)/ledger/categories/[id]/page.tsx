// Category Ledger drill — "เล่มสมุดค่าใช้จ่าย" for ONE category (C1 · tier 7a).
//
// Pick a category → see its whole history grouped by month, with a monthly total
// + a dependency-free trend line. Two axes (CEO-locked):
//   • หมวด        (?axis omitted) — whole-company total for this category
//   • หมวด × สาขา (?axis=branch&b=<branchId>) — e.g. "ค่าไฟ ของสาขา A"
//
// URL: /ledger/categories/[id]?company=&branch=&axis=&b=
//   - company/branch = the shared ledger scope (header picker)
//   - axis/b         = this page's own axis toggle (AxisToggle)
//
// Scope: org+company ALWAYS (one org = many legal entities → companyId is
// mandatory, never orgId alone). The actor's branch reach further narrows what a
// scoped LINE member may total (admin/accountant = company-wide). Real spend only
// (confirmed+locked) — drafts/void are excluded from the historical book.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { categoryLedger } from "@/lib/ledger/category-ledger";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { AxisToggle } from "../_components/AxisToggle";
import { MonthTable } from "../_components/MonthTable";
import { TrendChart } from "../_components/TrendChart";

export const dynamic = "force-dynamic";

function baht(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export default async function CategoryLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    company?: string;
    branch?: string;
    axis?: string;
    b?: string;
  }>;
}) {
  // Same financial-view tier as the expenses/home pages — this book exposes
  // company-wide spend history, so front-line roles are excluded (the per-actor
  // branch scope below is the second line of defence for scoped members).
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
    "program_admin",
  );

  const { id: categoryId } = await params;
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

  // Category must belong to THIS org+company (defence in depth — never trust the
  // path id alone; a wrong id from another company must 404, not leak a name).
  const category = await prisma.ledgerCategory.findFirst({
    where: { id: categoryId, orgId: scope.orgId, companyId: scope.companyId },
    select: { id: true, name: true, color: true },
  });
  if (!category) notFound();

  // Actor branch reach: admin/accountant = company-wide; a scoped member only
  // their branches. resolveLedgerActor() is the SAME gate the LIFF uses.
  const actor = await resolveLedgerActor();
  const actorScope = {
    allBranches: actor?.allBranches ?? true,
    scopeBranchIds: actor?.scopeBranchIds ?? [],
  };

  // Axis: ?axis=branch + ?b=<branchId> → CATEGORY × BRANCH; else whole company.
  const wantBranchAxis = sp.axis === "branch";
  const pinnedBranchId =
    wantBranchAxis && sp.b && scope.branches.some((b) => b.id === sp.b)
      ? sp.b
      : wantBranchAxis
        ? scope.branches[0]?.id ?? null
        : null;
  const axis: "category" | "branch" = pinnedBranchId ? "branch" : "category";

  const book = await categoryLedger({
    orgId: scope.orgId,
    companyId: scope.companyId,
    categoryId,
    branchId: pinnedBranchId,
    actorScope,
  });

  // Trend points oldest→newest (categoryLedger returns months newest-first).
  const trendPoints = [...book.months]
    .filter((m) => m.period !== "ไม่ระบุเดือน")
    .reverse()
    .map((m) => ({ period: m.period, total: m.total }));

  // Preserve scope params on the back link + receipt deep-links.
  const baseParams = new URLSearchParams();
  if (sp.company) baseParams.set("company", sp.company);
  if (sp.branch) baseParams.set("branch", sp.branch);
  const backHref = `/ledger/ledger-book${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  const pinnedBranchName = pinnedBranchId
    ? scope.branches.find((b) => b.id === pinnedBranchId)?.name ?? null
    : null;

  const subtitle =
    axis === "branch" && pinnedBranchName
      ? `${category.name} · สาขา ${pinnedBranchName}`
      : `${category.name} · ทั้งบริษัท`;

  return (
    <div className="p-4 sm:p-6">
      <Link
        href={backHref}
        className="press -ml-1 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        กลับไปสมุดค่าใช้จ่าย
      </Link>

      <LedgerHeader title={category.name} subtitle={subtitle} scope={scope} />

      {/* axis toggle + branch selector */}
      <div className="mb-4">
        <AxisToggle axis={axis} branchId={pinnedBranchId} branches={scope.branches} />
      </div>

      {/* headline totals */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="animate-fade-up rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold text-zinc-500">ยอดรวมทั้งหมด</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900">
            {baht(book.grandTotal)}
          </p>
        </div>
        <div className="animate-fade-up delay-100 rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold text-zinc-500">จำนวนใบ</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900">
            {book.grandCount.toLocaleString("en-US")}
            <span className="ml-1 text-sm font-medium text-zinc-500">ใบ</span>
          </p>
        </div>
      </div>

      {/* trend chart */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-bold text-zinc-800">แนวโน้มรายเดือน</h2>
        <TrendChart points={trendPoints} />
      </div>

      {/* month-by-month book */}
      <h2 className="mb-2 text-sm font-bold text-zinc-800">รายเดือน</h2>
      <MonthTable
        months={book.months}
        baseParams={baseParams.toString()}
        showBranch={axis === "category"}
      />
    </div>
  );
}
