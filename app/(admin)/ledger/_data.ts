// Ledger UI data helpers — Partition C.
//
// The canonical read layer is Partition B's `lib/ledger/queries.ts`; the UI
// consumes it directly (re-exported below for convenience). This file ONLY adds
// the few dashboard/budget aggregations B doesn't expose yet, all org+company
// scoped (RLS is the backstop; the app filter is primary — defence in depth).

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { BudgetRow } from "@/components/ledger/_kit/types";
import { currentPeriodBangkok, shiftPeriod } from "@/lib/ledger/dashboard";

// Re-export B's queries so pages have a single import surface.
export {
  listExpenses,
  listExpensesSummary,
  countExpenses,
  getExpense,
  listCategories,
  listCompanies,
  listBranches,
  spendByCategory,
  summarizeCompleteness,
  type ExpenseListFilter,
  type CategorySpendRow,
  type CompletenessSummary,
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

/** Monthly confirmed-spend trend (last N months) — for dashboard bars.
 *  Anchored on the Asia/Bangkok current month so the highlighted "current"
 *  bar and bucket labels match the period the dashboard page shows (avoids the
 *  UTC vs +07:00 off-by-one near the 1st of the month). */
export const expenseByMonth = cache(
  async (
    orgId: string,
    companyId: string,
    months = 6,
  ): Promise<Array<{ period: string; total: number }>> => {
    const anchor = currentPeriodBangkok(); // YYYY-MM (Bangkok)
    const startPeriod = shiftPeriod(anchor, -(months - 1));
    const [sy, sm] = startPeriod.split("-").map(Number);
    const start = new Date(Date.UTC(sy, sm - 1, 1));

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
      buckets.set(shiftPeriod(startPeriod, i), 0);
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

/** The connected LINE channel for a company (settings card). Reports WHETHER
 *  the encrypted secret/token are set — NEVER returns the secrets themselves
 *  (they only ever flow into the encrypted column, never back to the client). */
export const getLineChannel = cache(
  async (orgId: string, companyId: string) => {
    const ch = await prisma.ledgerLineChannel.findFirst({
      where: { orgId, companyId },
      select: {
        id: true,
        lineChannelId: true,
        groupId: true,
        branchId: true,
        active: true,
        webhookSecretEnc: true,
        accessTokenEnc: true,
        richMenuId: true,
      },
    });
    if (!ch) return null;
    return {
      id: ch.id,
      lineChannelId: ch.lineChannelId,
      groupId: ch.groupId,
      branchId: ch.branchId,
      active: ch.active,
      hasSecret: !!ch.webhookSecretEnc,
      hasAccessToken: !!ch.accessTokenEnc,
      richMenuId: ch.richMenuId,
    };
  },
);

export type LineChannelInfo = NonNullable<
  Awaited<ReturnType<typeof getLineChannel>>
>;

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

    if (budgets.length === 0) return [];

    // Used-vs-cap = confirmed+locked spend per (category × branch) in the period.
    // Compute it in ONE groupBy instead of one aggregate per budget (was N+1):
    // - branch-specific budget → match the (category, that-branch) bucket
    // - company-wide budget (branchId null) → sum all branch buckets for the cat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spendWhere: any = {
      orgId,
      companyId,
      status: { in: ["confirmed", "locked"] },
      categoryId: { in: budgets.map((b) => b.categoryId) },
    };
    if (/^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split("-").map(Number);
      spendWhere.docDate = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }
    const grouped = await prisma.ledgerExpense.groupBy({
      by: ["categoryId", "branchId"],
      where: spendWhere,
      _sum: { total: true },
    });

    // Lookup: per (cat,branch) and per-cat total (company-wide budgets).
    const byCatBranch = new Map<string, number>(); // key `${cat}|${branch}`
    const byCat = new Map<string, number>();
    for (const g of grouped) {
      if (!g.categoryId) continue;
      const amt = dec(g._sum.total);
      byCatBranch.set(`${g.categoryId}|${g.branchId ?? ""}`, amt);
      byCat.set(g.categoryId, (byCat.get(g.categoryId) ?? 0) + amt);
    }

    return budgets.map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      categoryName: b.category?.name ?? null,
      branchId: b.branchId,
      branchName: b.branch?.name ?? null,
      period: b.period,
      recurring: b.recurring,
      amount: dec(b.amount),
      alertPct: b.alertPct,
      used: b.branchId
        ? byCatBranch.get(`${b.categoryId}|${b.branchId}`) ?? 0
        : byCat.get(b.categoryId) ?? 0,
    }));
  },
);

/** Scoped LINE invites for a company (admin settings list). Not cached — the
 *  list changes on create/revoke. Resolves branch names for display. */
export async function listInvites(orgId: string, companyId: string) {
  const rows = await prisma.ledgerLineInvite.findMany({
    where: { orgId, companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      token: true,
      role: true,
      scopeBranchIds: true,
      scopeCategoryIds: true,
      note: true,
      expiresAt: true,
      usedAt: true,
      usedByLineUserId: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    role: r.role,
    branchCount: r.scopeBranchIds.length,
    categoryCount: r.scopeCategoryIds.length,
    note: r.note,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    used: !!r.usedAt,
    createdAt: r.createdAt.toISOString(),
  }));
}
export type InviteRow = Awaited<ReturnType<typeof listInvites>>[number];

/** LINE members of a company (back-office "ใครดูแลสาขาไหน"). Resolves branch
 *  names for the assigned scope + any pending self-request. Not cached — the
 *  list changes on assign/approve. */
export async function listLedgerMembers(orgId: string, companyId: string) {
  const rows = await prisma.ledgerLineMember.findMany({
    where: { orgId, companyId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      displayName: true,
      role: true,
      scopeBranchIds: true,
      pendingBranchId: true,
      poolUserId: true,
      active: true,
      createdAt: true,
    },
  });
  const ids = Array.from(
    new Set(
      rows.flatMap((r) =>
        [...r.scopeBranchIds, r.pendingBranchId].filter(Boolean) as string[],
      ),
    ),
  );
  const branches = ids.length
    ? await prisma.branch.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(branches.map((b) => [b.id, b.name]));
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    role: r.role,
    scopeBranchIds: r.scopeBranchIds,
    scopeBranchNames: r.scopeBranchIds.map((id) => nameById.get(id) ?? "?"),
    pendingBranchId: r.pendingBranchId,
    pendingBranchName: r.pendingBranchId ? nameById.get(r.pendingBranchId) ?? null : null,
    poolUserId: r.poolUserId,
    poolLinked: !!r.poolUserId,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  }));
}
export type LedgerMemberRow = Awaited<ReturnType<typeof listLedgerMembers>>[number];

/** Group → branch overrides (B3 multi-group). Each row = one LINE group pinned to
 *  its own branch. Rows self-register when an admin types "/setting สาขา <สาขา>"
 *  inside a branch group; the webhook reads them to auto-tag receipts per group. */
export async function listLedgerGroups(orgId: string, companyId: string) {
  // Defensive: tolerate the table not existing yet (deploy landing before the
  // additive migration is applied) — the settings page must never 500 on this.
  const rows = await prisma.ledgerLineGroup
    .findMany({
      where: { orgId, companyId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      take: 200,
      select: { id: true, groupId: true, branchId: true, label: true, memberCount: true, active: true, isSlipIntake: true },
    })
    .catch(() => [] as { id: string; groupId: string; branchId: string | null; label: string | null; memberCount: number | null; active: boolean; isSlipIntake: boolean }[]);
  const ids = Array.from(new Set(rows.map((r) => r.branchId).filter(Boolean) as string[]));
  const branches = ids.length
    ? await prisma.branch.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(branches.map((b) => [b.id, b.name]));
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    branchId: r.branchId,
    branchName: r.branchId ? nameById.get(r.branchId) ?? null : null,
    label: r.label,
    memberCount: r.memberCount,
    active: r.active,
    isSlipIntake: r.isSlipIntake,
  }));
}
export type LedgerGroupRow = Awaited<ReturnType<typeof listLedgerGroups>>[number];
