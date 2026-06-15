// Ledger home — KPI summary (ภาพรวมเร็ว) + ทางลัดไปยังรายจ่ายที่รอยืนยัน.
// Real data, org+company(+branch) scoped, current month.
import Link from "next/link";
import {
  Receipt,
  FileClock,
  CheckCircle2,
  Wallet,
  BookOpen,
  ChevronRight,
  ListChecks,
  Tags,
  AlertTriangle,
  Send,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "./_scope";
import { LedgerHeader, NoCompanyState } from "./_components/LedgerHeader";
import { expenseSummary, listExpensesSummary, spendByCategory } from "./_data";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { categoryBookIndex } from "@/lib/ledger/category-ledger";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { LedgerEmptyState, LedgerMascot } from "@/components/ledger/Brand";

export const dynamic = "force-dynamic";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export default async function LedgerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  // Page-level role gate (same financial-view tier as the dashboard nav policy).
  // The home KPI tiles surface company-wide financials (posted total, confirmed
  // count, spend-by-category) → front-line roles (staff/driver/branch_manager/
  // program_admin) must not see them. Layout assertModuleEnabled only checks the
  // module grant, not the role, so we gate here like dashboard/settings/budgets.
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
        <LedgerHeader title="ระบบบัญชี" subtitle="ภาพรวม" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const period = currentPeriodBangkok();
  const filter = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    period,
  };

  const [summary, drafts, byCategory] = await Promise.all([
    expenseSummary(filter),
    listExpensesSummary({ ...filter, status: "draft", take: 6 }).then((r) => r.expenses),
    spendByCategory(filter),
  ]);

  // "งานที่ต้องทำ" (redesign 2026-06-07) — actionable backlog counts, company-scoped
  // (not period-limited; tasks are "do now"): ใบร่างขาดหมวด/สาขา · ขอคืน VAT ไม่ได้ (แดง) ·
  // ยืนยันแล้วรอส่ง TRCloud. companyId filter ติดไว้เสมอ (กันรั่วข้ามนิติบุคคล).
  const taskBase = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
  };
  const [needClassify, vatBlocked, pendingTrcloud] = await Promise.all([
    prisma.ledgerExpense.count({
      where: { ...taskBase, status: "draft", OR: [{ branchId: null }, { categoryId: null }] },
    }),
    prisma.ledgerExpense.count({
      where: {
        ...taskBase,
        status: { in: ["draft", "confirmed", "locked"] },
        completenessStatus: "red_invalid",
      },
    }),
    prisma.ledgerExpense.count({
      // ยืนยันแล้วแต่ยังไม่เข้า TRCloud — never pushed (null) OR last push FAILED
      // ("error"). Failed bills must count as "ยังต้องทำ", not silently sent.
      where: { ...taskBase, status: "confirmed", OR: [{ trcloudDocId: null }, { trcloudDocId: "error" }] },
    }),
  ]);

  // "ค่าใช้จ่ายประจำ" teaser → surfaces สมุดค่าใช้จ่าย on the home page so the CEO
  // actually finds it (workshop 2026-06-07: he never found it buried in the nav).
  // Reuses categoryBookIndex (already deployed) — top categories this month + Δ%.
  const actor = await resolveLedgerActor();
  const recurring = await categoryBookIndex({
    orgId: scope.orgId,
    companyId: scope.companyId,
    actorScope: {
      allBranches: actor?.allBranches ?? true,
      scopeBranchIds: actor?.scopeBranchIds ?? [],
    },
    months: 2,
    anchorPeriod: period,
  });
  const topRecurring = [...recurring]
    .filter((e) => e.latestTotal > 0)
    .sort((a, b) => b.latestTotal - a.latestTotal)
    .slice(0, 3)
    .map((e) => {
      const cur = e.spark[e.spark.length - 1] ?? 0;
      const prev = e.spark[e.spark.length - 2] ?? 0;
      const deltaPct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
      return { categoryId: e.categoryId, name: e.categoryName, latest: e.latestTotal, deltaPct };
    });

  const tiles = [
    {
      label: "รอยืนยัน (ร่าง)",
      value: summary.draftCount,
      unit: "ใบ",
      icon: FileClock,
      tone: "amber",
      href: "/ledger/expenses?status=draft",
    },
    {
      label: "ยืนยันแล้วเดือนนี้",
      value: summary.confirmedCount,
      unit: "ใบ",
      icon: CheckCircle2,
      tone: "emerald",
      href: "/ledger/expenses?status=confirmed",
    },
    {
      label: "ค่าใช้จ่ายเดือนนี้",
      value: baht(summary.postedTotal),
      unit: "",
      icon: Wallet,
      tone: "blue",
      href: "/ledger/dashboard",
    },
    {
      // Per-company total (scope is one companyId) — NOT org-wide. The module
      // has no cross-company aggregation yet, so label it per-company to avoid
      // a CEO running 2 companies reading this as an org-wide figure.
      label: "ทั้งหมดในบริษัทนี้",
      value: summary.totalCount,
      unit: "ใบ",
      icon: Receipt,
      tone: "zinc",
      href: "/ledger/expenses",
    },
  ] as const;

  // KPI tile outlines are neutral (decorative colored rings read as AI-slop and
  // carry no real status). Semantic color lives on the icon instead. Exception:
  // the single actionable "รอยืนยัน" tile keeps an amber ring — genuine "needs you".
  const toneRing: Record<string, string> = {
    amber: "ring-amber-300 text-amber-600",
    emerald: "ring-zinc-200 text-emerald-600",
    blue: "ring-zinc-200 text-sky-600",
    zinc: "ring-zinc-200 text-zinc-500",
  };

  const taskTone: Record<string, string> = {
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    blue: "bg-blue-50 text-blue-600",
  };
  const tasks = [
    {
      icon: Tags,
      tone: "amber",
      label: "ใบร่างยังไม่ครบ หมวด/สาขา",
      count: needClassify,
      cta: "เติม",
      href: "/ledger/expenses?status=draft",
    },
    {
      icon: AlertTriangle,
      tone: "rose",
      label: "ใบขอคืนภาษีซื้อไม่ได้",
      count: vatBlocked,
      cta: "ดู",
      href: "/ledger/expenses?cc=red",
    },
    {
      icon: Send,
      tone: "blue",
      label: "ใบยืนยันแล้ว รอส่ง TRCloud",
      count: pendingTrcloud,
      cta: "ส่ง",
      href: "/ledger/expenses?status=confirmed&tr=unsent",
    },
  ].filter((t) => t.count > 0);

  const topCat = byCategory.slice(0, 5);
  const maxCat = Math.max(1, ...topCat.map((c) => c.total));

  const buildHref = (base: string) => {
    const qs = new URLSearchParams();
    if (sp.company) qs.set("company", sp.company);
    if (sp.branch) qs.set("branch", sp.branch);
    const s = qs.toString();
    return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
  };

  return (
    <div className="p-4 sm:p-6">
      <LedgerHeader
        title="ระบบบัญชี"
        subtitle={`ภาพรวมเดือน ${period}`}
        scope={scope}
        right={
          <Link
            href={buildHref("/ledger/expenses")}
            className="inline-flex h-9 items-center rounded-lg bg-[var(--color-brand-600)] px-3 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
          >
            จัดการรายจ่าย
          </Link>
        }
      />

      {/* Welcome banner — น้องใบเสร็จ greets + nudges the draft queue (web + mobile) */}
      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <LedgerMascot
          pose={summary.draftCount > 0 ? "receipt" : "welcome"}
          size={72}
          priority
          className="shrink-0 drop-shadow-sm"
        />
        <div className="min-w-0">
          <p className="text-base font-bold text-zinc-900">
            {summary.draftCount > 0
              ? `มี ${summary.draftCount} ใบรอตรวจ — ช่วยยืนยันหน่อยนะ`
              : "สวัสดีครับ พร้อมช่วยจดค่าใช้จ่าย"}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">
            ถ่ายใบเสร็จส่งในกลุ่ม LINE หรือพิมพ์ &ldquo;จด กาแฟ 45&rdquo; — น้องใบเสร็จจัดให้
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={buildHref(t.href)}
              className={`flex min-h-[110px] flex-col justify-between gap-2 rounded-2xl bg-white p-4 ring-1 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-400)] ${toneRing[t.tone]}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">
                  {t.label}
                </span>
                <Icon className="size-4 shrink-0" aria-hidden />
              </div>
              <div className="text-2xl font-extrabold tabular-nums text-zinc-900 sm:text-3xl">
                {typeof t.value === "number"
                  ? t.value.toLocaleString("en-US")
                  : t.value}
                {t.unit && (
                  <span className="ml-1 text-sm font-medium text-zinc-500">
                    {t.unit}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* งานที่ต้องทำ — actionable backlog (redesign 2026-06-07): สิ่งที่บัญชีต้อง
          จัดการก่อน · กดเข้าหน้ารายจ่ายที่กรองไว้ให้แล้ว. ซ่อนเองถ้าเคลียร์หมด. */}
      {tasks.length > 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="size-4 text-[var(--color-brand-600)]" aria-hidden />
            <h2 className="text-sm font-bold text-zinc-800">งานที่ต้องทำ</h2>
          </div>
          <ul className="divide-y divide-zinc-100">
            {tasks.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.label}>
                  <Link
                    href={buildHref(t.href)}
                    className="flex items-center gap-3 py-2.5 transition-colors hover:bg-zinc-50"
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${taskTone[t.tone]}`}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-zinc-800">
                      {t.label}
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
                      {t.count}
                      <span className="ml-0.5 text-xs font-normal text-zinc-500">ใบ</span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-[var(--color-brand-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand-700)]">
                      {t.cta}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ค่าใช้จ่ายประจำ — entry to สมุดค่าใช้จ่าย (ดูย้อนหลัง/เทียบเดือน) */}
      <Link
        href={buildHref("/ledger/ledger-book")}
        className="mt-6 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-all hover:border-[var(--color-brand-200)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-400)]"
      >
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-600)] ring-1 ring-[var(--color-brand-100)]">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-zinc-900">สมุดค่าใช้จ่าย — ดูย้อนหลัง</span>
            <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
          </div>
          {topRecurring.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {topRecurring.map((r) => (
                <li key={r.categoryId} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate text-zinc-600">{r.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="font-semibold tabular-nums text-zinc-800">{baht(r.latest)}</span>
                    {r.deltaPct !== null && Math.abs(r.deltaPct) >= 1 && (
                      <span
                        className={`text-[11px] font-semibold tabular-nums ${
                          r.deltaPct > 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {r.deltaPct > 0 ? "▲" : "▼"} {Math.abs(Math.round(r.deltaPct))}%
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-sm text-zinc-500">
              เทียบค่าไฟ/ค่าน้ำ/ค่าใช้จ่ายแต่ละหมวด ย้อนหลังรายเดือน-รายปี
            </p>
          )}
        </div>
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* รอยืนยัน */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-800">รอยืนยันล่าสุด</h2>
            <Link
              href={buildHref("/ledger/expenses?status=draft")}
              className="text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ดูทั้งหมด
            </Link>
          </div>
          {drafts.length === 0 ? (
            <LedgerEmptyState
              mascotSize={48}
              className="py-6"
              title="ไม่มีใบรอยืนยัน"
              hint="ทุกใบเสร็จถูกยืนยันครบแล้ว"
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {drafts.map((d) => (
                <li key={d.id}>
                  <Link
                    href={buildHref(`/ledger/expenses?selected=${d.id}`)}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-800">
                        {d.vendor || "ไม่ระบุผู้ขาย"}
                      </div>
                      <div className="truncate font-mono text-xs text-zinc-500">
                        {d.docCode}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {baht(d.total)}
                      </span>
                      <StatusBadge status={d.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ค่าใช้จ่ายตามหมวด */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-800">
              ค่าใช้จ่ายตามหมวด (เดือนนี้)
            </h2>
            <Link
              href={buildHref("/ledger/dashboard")}
              className="text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              Dashboard
            </Link>
          </div>
          {topCat.length === 0 ? (
            <LedgerEmptyState
              mascotSize={48}
              className="py-6"
              title="ยังไม่มีค่าใช้จ่ายที่ยืนยัน"
              hint="พอยืนยันใบเสร็จแล้ว ยอดตามหมวดจะขึ้นที่นี่"
            />
          ) : (
            <ul className="space-y-2.5">
              {topCat.map((c) => (
                <li key={c.categoryId ?? "none"}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate text-zinc-700">
                      {c.categoryName ?? "ไม่ระบุหมวด"}
                    </span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      {baht(c.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-[var(--color-brand-500)]"
                      style={{ width: `${(c.total / maxCat) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
