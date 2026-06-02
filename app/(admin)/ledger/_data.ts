// Ledger UI data helpers — Partition C.
//
// The canonical read layer is Partition B's `lib/ledger/queries.ts`; the UI
// consumes it directly (re-exported below for convenience). This file ONLY adds
// the few dashboard/budget aggregations B doesn't expose yet, all org+company
// scoped (RLS is the backstop; the app filter is primary — defence in depth).

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { BudgetRow } from "@/components/ledger/_kit/types";

// Re-export B's queries so pages have a single import surface.
export {
  listExpenses,
  countExpenses,
  getExpense,
  listCategories,
  listCompanies,
  listBranches,
  spendByCategory,
  type ExpenseListFilter,
  type CategorySpendRow,
} from "@/lib/ledger/queries";

type DecimalLike = { toNumber: () => number } | number | null | undefined;
function dec(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

/** Headline KPI numbers for the home + dashboard surfaces. */
export const expenseSummary = cache(
  async (opts: {
    orgId: string;
    companyId: string;
    branchId?: string | null;
    period?: string | null;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = { orgId: opts.orgId, companyId: opts.companyId };
    if (opts.branchId) base.branchId = opts.branchId;
    if (opts.period && /^\d{4}-\d{2}$/.test(opts.period)) {
      const [y, m] = opts.period.split("-").map(Number);
      base.docDate = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const [draftCount, confirmedAgg, postedAgg, totalCount] = await Promise.all([
      prisma.ledgerExpense.count({ where: { ...base, status: "draft" } }),
      prisma.ledgerExpense.aggregate({
        where: { ...base, status: "confirmed" },
        _sum: { total: true },
        _count: true,
      }),
      prisma.ledgerExpense.aggregate({
        where: { ...base, status: { in: ["confirmed", "locked"] } },
        _sum: { total: true },
      }),
      prisma.ledgerExpense.count({ where: base }),
    ]);
    return {
      draftCount,
      confirmedCount: confirmedAgg._count,
      confirmedTotal: dec(confirmedAgg._sum.total),
      postedTotal: dec(postedAgg._sum.total),
      totalCount,
    };
  },
);

/** Confirmed spend grouped by branch (for dashboard). */
export const expenseByBranch = cache(
  async (opts: {
    orgId: string;
    companyId: string;
    period?: string | null;
  }): Promise<Array<{ branchId: string | null; name: string; total: number }>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      orgId: opts.orgId,
      companyId: opts.companyId,
      status: { in: ["confirmed", "locked"] },
    };
    if (opts.period && /^\d{4}-\d{2}$/.test(opts.period)) {
      const [y, m] = opts.period.split("-").map(Number);
      where.docDate = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const grouped = await prisma.ledgerExpense.groupBy({
      by: ["branchId"],
      where,
      _sum: { total: true },
    });
    const branches = await prisma.branch.findMany({
      where: { orgId: opts.orgId, companyId: opts.companyId },
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));
    return grouped
      .map((g) => ({
        branchId: g.branchId,
        name: g.branchId ? nameById.get(g.branchId) ?? "ไม่ระบุสาขา" : "ส่วนกลาง",
        total: dec(g._sum.total),
      }))
      .sort((a, b) => b.total - a.total);
  },
);

/** Monthly confirmed-spend trend (last N months) — for dashboard bars. */
export const expenseByMonth = cache(
  async (
    orgId: string,
    companyId: string,
    months = 6,
  ): Promise<Array<{ period: string; total: number }>> => {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );
    const rows = await prisma.ledgerExpense.findMany({
      where: {
        orgId,
        companyId,
        status: { in: ["confirmed", "locked"] },
        docDate: { gte: start },
      },
      select: { docDate: true, total: true },
    });
    const buckets = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1) + i, 1),
      );
      buckets.set(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
        0,
      );
    }
    for (const r of rows) {
      if (!r.docDate) continue;
      const key = `${r.docDate.getUTCFullYear()}-${String(r.docDate.getUTCMonth() + 1).padStart(2, "0")}`;
      if (buckets.has(key))
        buckets.set(key, (buckets.get(key) ?? 0) + dec(r.total));
    }
    return Array.from(buckets.entries()).map(([period, total]) => ({
      period,
      total,
    }));
  },
);

/** Budgets with used-vs-cap computed from confirmed spend in the period. */
export const listBudgets = cache(
  async (
    orgId: string,
    companyId: string,
    period: string,
  ): Promise<BudgetRow[]> => {
    const budgets = await prisma.ledgerBudget.findMany({
      where: { orgId, companyId, OR: [{ period }, { recurring: true }] },
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const out: BudgetRow[] = [];
    for (const b of budgets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {
        orgId,
        companyId,
        categoryId: b.categoryId,
        status: { in: ["confirmed", "locked"] },
      };
      if (b.branchId) where.branchId = b.branchId;
      if (/^\d{4}-\d{2}$/.test(period)) {
        const [y, m] = period.split("-").map(Number);
        where.docDate = {
          gte: new Date(Date.UTC(y, m - 1, 1)),
          lt: new Date(Date.UTC(y, m, 1)),
        };
      }
      const agg = await prisma.ledgerExpense.aggregate({
        where,
        _sum: { total: true },
      });
      out.push({
        id: b.id,
        categoryId: b.categoryId,
        categoryName: b.category?.name ?? null,
        branchId: b.branchId,
        branchName: b.branch?.name ?? null,
        period: b.period,
        recurring: b.recurring,
        amount: dec(b.amount),
        alertPct: b.alertPct,
        used: dec(agg._sum.total),
      });
    }
    return out;
  },
);
