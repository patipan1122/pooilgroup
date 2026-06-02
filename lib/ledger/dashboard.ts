// LedgerLine — dashboard aggregation queries.
//
// Real spend aggregates for the Dashboard surface AND the shared data source
// for insights.ts (AI bullets) + qa.ts (LINE Q&A). Keep ALL aggregation logic
// here so the AI layers never write their own Prisma — they call these.
//
// SPEND = confirmed + locked only. Drafts are NOT real spend yet (GOLDEN RULE:
// nothing counts until a human confirms). Every query is org+company scoped
// (RLS is the backstop; we also filter explicitly — defence in depth).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type DecimalLike = { toNumber: () => number } | number | null | undefined;
function dec(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

/** Real spend = confirmed + locked (drafts/void excluded). */
const SPEND_STATUS = ["confirmed", "locked"] as const;

export interface DashboardScope {
  orgId: string;
  companyId: string;
  branchId?: string | null;
  /** YYYY-MM — defaults to current month (Asia/Bangkok) when omitted. */
  period?: string | null;
}

/** Current month in Asia/Bangkok as YYYY-MM (day-boundary lesson from Pool). */
export function currentPeriodBangkok(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  });
  // en-CA → "2026-06"
  return fmt.format(new Date());
}

/** Today (Asia/Bangkok) as YYYY-MM-DD. */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Resolve a "YYYY-MM" → UTC [start, end) doc_date bounds. */
function monthBounds(period: string): { start: Date; end: Date } | null {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return null;
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/** Shift a "YYYY-MM" by N months (negative = back). */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function baseWhere(scope: DashboardScope): Prisma.LedgerExpenseWhereInput {
  const where: Prisma.LedgerExpenseWhereInput = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    status: { in: [...SPEND_STATUS] },
  };
  if (scope.branchId) where.branchId = scope.branchId;
  return where;
}

function withPeriod(
  where: Prisma.LedgerExpenseWhereInput,
  period: string | null | undefined,
): Prisma.LedgerExpenseWhereInput {
  if (!period) return where;
  const b = monthBounds(period);
  if (!b) return where;
  return { ...where, docDate: { gte: b.start, lt: b.end } };
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

export interface SpendTotals {
  /** Real spend (confirmed+locked) in the period. */
  total: number;
  count: number;
  vat: number;
  /** Drafts still awaiting confirmation (count + their summed total). */
  draftCount: number;
  draftTotal: number;
}

/** Headline totals for a company/period: real spend + outstanding drafts. */
export async function spendTotals(scope: DashboardScope): Promise<SpendTotals> {
  const period = scope.period ?? currentPeriodBangkok();
  const spendWhere = withPeriod(baseWhere(scope), period);

  const draftWhere: Prisma.LedgerExpenseWhereInput = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    status: "draft",
  };
  if (scope.branchId) draftWhere.branchId = scope.branchId;
  const draftWhereP = withPeriod(draftWhere, period);

  const [spend, drafts] = await Promise.all([
    prisma.ledgerExpense.aggregate({
      where: spendWhere,
      _sum: { total: true, vat: true },
      _count: { _all: true },
    }),
    prisma.ledgerExpense.aggregate({
      where: draftWhereP,
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  return {
    total: dec(spend._sum.total),
    count: spend._count._all,
    vat: dec(spend._sum.vat),
    draftCount: drafts._count._all,
    draftTotal: dec(drafts._sum.total),
  };
}

export interface CategorySpend {
  categoryId: string | null;
  categoryName: string | null;
  total: number;
  count: number;
}

/** Spend grouped by category for a period (desc by total). */
export async function spendByCategory(
  scope: DashboardScope,
): Promise<CategorySpend[]> {
  const period = scope.period ?? currentPeriodBangkok();
  const where = withPeriod(baseWhere(scope), period);

  const grouped = await prisma.ledgerExpense.groupBy({
    by: ["categoryId"],
    where,
    _sum: { total: true },
    _count: { _all: true },
  });

  const ids = grouped.map((g) => g.categoryId).filter((x): x is string => !!x);
  const cats =
    ids.length > 0
      ? await prisma.ledgerCategory.findMany({
          where: { id: { in: ids }, orgId: scope.orgId },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(cats.map((c) => [c.id, c.name]));

  return grouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryId ? nameById.get(g.categoryId) ?? null : null,
      total: dec(g._sum.total),
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface BranchSpend {
  branchId: string | null;
  branchName: string | null;
  total: number;
  count: number;
}

/** Spend grouped by branch for a period (desc by total). */
export async function spendByBranch(
  scope: DashboardScope,
): Promise<BranchSpend[]> {
  const period = scope.period ?? currentPeriodBangkok();
  // Branch breakdown ignores any single-branch filter on scope.
  const where = withPeriod(
    baseWhere({ ...scope, branchId: null }),
    period,
  );

  const grouped = await prisma.ledgerExpense.groupBy({
    by: ["branchId"],
    where,
    _sum: { total: true },
    _count: { _all: true },
  });

  const ids = grouped.map((g) => g.branchId).filter((x): x is string => !!x);
  const branches =
    ids.length > 0
      ? await prisma.branch.findMany({
          where: { id: { in: ids }, orgId: scope.orgId },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(branches.map((b) => [b.id, b.name]));

  return grouped
    .map((g) => ({
      branchId: g.branchId,
      branchName: g.branchId ? nameById.get(g.branchId) ?? null : null,
      total: dec(g._sum.total),
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface MonthlyPoint {
  period: string; // YYYY-MM
  total: number;
  count: number;
}

/**
 * Spend per month for the trailing N months ending at `period` (inclusive).
 * Returns oldest→newest with zero-filled gaps so a sparkline/MoM is stable.
 */
export async function spendByMonth(
  scope: DashboardScope,
  months = 6,
): Promise<MonthlyPoint[]> {
  const endPeriod = scope.period ?? currentPeriodBangkok();
  const startPeriod = shiftPeriod(endPeriod, -(months - 1));
  const startB = monthBounds(startPeriod);
  const endB = monthBounds(endPeriod);
  if (!startB || !endB) return [];

  const where: Prisma.LedgerExpenseWhereInput = {
    ...baseWhere(scope),
    docDate: { gte: startB.start, lt: endB.end },
  };

  const rows = await prisma.ledgerExpense.findMany({
    where,
    select: { docDate: true, total: true },
  });

  // Bucket by YYYY-MM in UTC (doc_date is stored UTC-midnight per ingest).
  const bucket = new Map<string, { total: number; count: number }>();
  for (let i = 0; i < months; i++) {
    bucket.set(shiftPeriod(startPeriod, i), { total: 0, count: 0 });
  }
  for (const r of rows) {
    if (!r.docDate) continue;
    const key = `${r.docDate.getUTCFullYear()}-${String(
      r.docDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    const b = bucket.get(key);
    if (b) {
      b.total += dec(r.total);
      b.count += 1;
    }
  }

  return [...bucket.entries()].map(([period, v]) => ({
    period,
    total: v.total,
    count: v.count,
  }));
}

export interface BudgetVsActual {
  categoryId: string;
  categoryName: string | null;
  /** null = company-wide budget · set = branch-specific budget. */
  branchId: string | null;
  budget: number;
  actual: number;
  /** actual / budget · 0 when no budget set. */
  usedPct: number;
  alertPct: number;
  /** true when usedPct >= alertPct. */
  overAlert: boolean;
  /** true when actual > budget. */
  overBudget: boolean;
}

/**
 * Budget vs actual for a period. Matches a budget row for the exact period OR a
 * recurring budget (recurring=true) — period-specific wins per (category,branch).
 *
 * IMPORTANT (must mirror _data.ts listBudgets so the AI/QA layer and the page's
 * budget table never contradict):
 *   - actual is computed via groupBy [categoryId, branchId] over the period, NOT
 *     the company-wide spendByCategory total.
 *   - branch-specific budget (branchId set) → compared against the (cat, that-branch)
 *     bucket only.
 *   - company-wide budget (branchId null) → compared against the SUM of all branch
 *     buckets for the category.
 *   - result map is keyed by `${categoryId}|${branchId ?? ""}` so per-branch and
 *     company-wide budgets for the same category don't collide (which previously
 *     let one cap shadow the other and fired false "ใช้เกินงบ" alerts).
 */
export async function budgetVsActual(
  scope: DashboardScope,
): Promise<BudgetVsActual[]> {
  const period = scope.period ?? currentPeriodBangkok();

  const budgets = await prisma.ledgerBudget.findMany({
    where: {
      orgId: scope.orgId,
      companyId: scope.companyId,
      // Respect a single-branch scope; otherwise consider all (company-wide +
      // every branch-specific) budgets — the actual lookup below keeps them apart.
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      OR: [{ period }, { recurring: true }],
    },
    select: {
      categoryId: true,
      branchId: true,
      period: true,
      recurring: true,
      amount: true,
      alertPct: true,
      category: { select: { name: true } },
    },
  });

  if (budgets.length === 0) return [];

  // Period-specific budget wins over a recurring one for the SAME (cat,branch).
  const byKey = new Map<
    string,
    {
      categoryId: string;
      branchId: string | null;
      amount: number;
      alertPct: number;
      name: string | null;
      specific: boolean;
    }
  >();
  for (const b of budgets) {
    const key = `${b.categoryId}|${b.branchId ?? ""}`;
    const specific = b.period === period && !b.recurring;
    const prev = byKey.get(key);
    if (!prev || (specific && !prev.specific)) {
      byKey.set(key, {
        categoryId: b.categoryId,
        branchId: b.branchId,
        amount: dec(b.amount),
        alertPct: b.alertPct,
        name: b.category?.name ?? null,
        specific,
      });
    }
  }

  // Actual spend grouped per (category, branch) for the period.
  const where: Prisma.LedgerExpenseWhereInput = {
    orgId: scope.orgId,
    companyId: scope.companyId,
    status: { in: [...SPEND_STATUS] },
    categoryId: { in: [...new Set(budgets.map((b) => b.categoryId))] },
  };
  const b = monthBounds(period);
  if (b) where.docDate = { gte: b.start, lt: b.end };

  const grouped = await prisma.ledgerExpense.groupBy({
    by: ["categoryId", "branchId"],
    where,
    _sum: { total: true },
  });

  const byCatBranch = new Map<string, number>(); // `${cat}|${branch}`
  const byCat = new Map<string, number>(); // company-wide total per category
  for (const g of grouped) {
    if (!g.categoryId) continue;
    const amt = dec(g._sum.total);
    byCatBranch.set(`${g.categoryId}|${g.branchId ?? ""}`, amt);
    byCat.set(g.categoryId, (byCat.get(g.categoryId) ?? 0) + amt);
  }

  return [...byKey.values()].map((bud) => {
    const actual = bud.branchId
      ? byCatBranch.get(`${bud.categoryId}|${bud.branchId}`) ?? 0
      : byCat.get(bud.categoryId) ?? 0;
    const usedPct = bud.amount > 0 ? (actual / bud.amount) * 100 : 0;
    return {
      categoryId: bud.categoryId,
      categoryName: bud.name,
      branchId: bud.branchId,
      budget: bud.amount,
      actual,
      usedPct,
      alertPct: bud.alertPct,
      overAlert: bud.amount > 0 && usedPct >= bud.alertPct,
      overBudget: bud.amount > 0 && actual > bud.amount,
    };
  });
}

export interface DashboardSnapshot {
  period: string;
  prevPeriod: string;
  totals: SpendTotals;
  prevTotal: number;
  /** MoM change vs prev month as a percentage (null when prev = 0). */
  momPct: number | null;
  byCategory: CategorySpend[];
  byBranch: BranchSpend[];
  byMonth: MonthlyPoint[];
  budgets: BudgetVsActual[];
}

/**
 * One-shot snapshot the Dashboard page (and insights/qa) can render from a
 * single call. All sub-queries run in parallel.
 */
export async function dashboardSnapshot(
  scope: DashboardScope,
): Promise<DashboardSnapshot> {
  const period = scope.period ?? currentPeriodBangkok();
  const prevPeriod = shiftPeriod(period, -1);

  const [totals, prev, byCategory, byBranch, byMonth, budgets] =
    await Promise.all([
      spendTotals({ ...scope, period }),
      spendTotals({ ...scope, period: prevPeriod }),
      spendByCategory({ ...scope, period }),
      spendByBranch({ ...scope, period }),
      spendByMonth({ ...scope, period }, 6),
      budgetVsActual({ ...scope, period }),
    ]);

  const momPct =
    prev.total > 0 ? ((totals.total - prev.total) / prev.total) * 100 : null;

  return {
    period,
    prevPeriod,
    totals,
    prevTotal: prev.total,
    momPct,
    byCategory,
    byBranch,
    byMonth,
    budgets,
  };
}
