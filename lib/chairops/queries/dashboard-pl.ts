// ============================================================
// Exec dashboard P&L query (CEO ask 2026-05-28)
// ============================================================
// CEO feedback on the office home:
//   1) "กดดูทุกสาขาพร้อมกันไม่ได้แล้ว" → need ALL active branches in one table.
//   2) date-range filter (เลือกวันไหนถึงวันไหน).
//   3) profit/loss per branch INCLUDING rent (ค่าเช่า) cost.
//
// getBranchPL({ orgId, from, to }) returns one row per ACTIVE branch with:
//   - revenue (sum ChairopsBranchDailyRevenue.grossTotal in [from, to])
//   - cash / online split (cashTotal + onlineTotal in range)
//   - deposit (sum ChairopsCashCollection.depositedAmount in range)
//   - drift (from the ChairopsDrift cache · positive = shortage)
//   - pro-rated cost = monthlyCost × (days in range / 30) · broken out by rent
//   - net = revenue − proratedCost
//
// SECURITY: orgId is filtered on EVERY query (cross-org leak was a P0 this
// session — getDashboardRows comment documents the same risk). Cost fields are
// admin-tier only · the PAGE gates the cost/profit columns by role, but this
// query always computes them (caller decides what to render).
//
// Decimal → Number BEFORE any math (Prisma Decimal would silently break +/−).

import { prisma } from "@/lib/prisma";

const PRORATE_MONTH_DAYS = 30;

function decToNum(
  d: { toNumber: () => number } | number | null | undefined,
): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return d.toNumber();
}

/** Inclusive whole-day count between two midnights (Asia/Bangkok day grain). */
export function rangeDayCount(from: Date, to: Date): number {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

export interface BranchPLRow {
  branchId: string;
  branchSlug: string;
  name: string;
  mallGroup: string | null;
  isActive: boolean;
  /** gross POS revenue (cash + online + other) over the range. */
  revenue: number;
  cash: number;
  online: number;
  /** maid deposits over the range. */
  deposit: number;
  /** cumulative drift from cache · positive = shortage. */
  drift: number;
  /** pro-rated total cost over the range (rent + util + staff + other). */
  cost: number;
  /** ค่าเช่า broken out for the tooltip/sub-line. */
  rentCost: number;
  /** revenue − cost · negative = ขาดทุน. */
  net: number;
}

export interface BranchPLResult {
  rows: BranchPLRow[];
  /** inclusive day count used for cost pro-ration. */
  dayCount: number;
  totals: {
    revenue: number;
    cash: number;
    online: number;
    deposit: number;
    drift: number;
    cost: number;
    rentCost: number;
    net: number;
  };
}

/**
 * Per-branch P&L for a date range. `from`/`to` are inclusive day boundaries;
 * caller passes Bangkok-local midnights. orgId-scoped on every query.
 */
export async function getBranchPL(args: {
  orgId: string;
  from: Date;
  to: Date;
}): Promise<BranchPLResult> {
  const { orgId } = args;

  // Normalise to [start-of-from, start-of-day-after-to) so the whole `to` day
  // is included regardless of time component.
  const gte = new Date(args.from);
  gte.setHours(0, 0, 0, 0);
  const ltExclusive = new Date(args.to);
  ltExclusive.setHours(0, 0, 0, 0);
  ltExclusive.setDate(ltExclusive.getDate() + 1);

  const dayCount = rangeDayCount(args.from, args.to);
  const prorateFactor = dayCount / PRORATE_MONTH_DAYS;

  const [branches, revenueRows, legacyPosRows, depositRows, drifts] = await Promise.all([
    // All ACTIVE branches (empty-state friendly: 0-revenue branches still show).
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        mallGroup: true,
        isActive: true,
        monthlyRent: true,
        monthlyUtility: true,
        monthlyStaff: true,
        monthlyOther: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsBranchDailyRevenue.groupBy({
      by: ["branchId"],
      where: { orgId, bizDate: { gte, lt: ltExclusive } },
      _sum: { grossTotal: true, cashTotal: true, onlineTotal: true },
    }),
    // CEO 2026-06-02 P0 fix: branches whose POS lands in the legacy per-chair
    // table (chairops_pos_daily) but NEVER in the new aggregate
    // (chairops_branch_daily_revenue) — e.g. central โคราช — would show
    // "—" everywhere in ภาพรวม because the only POS source returned no rows.
    // Same fallback shape as drift-engine + reconcile-v2 ledger so all
    // three surfaces agree on what revenue a branch had.
    prisma.chairopsPosDaily.groupBy({
      by: ["branchId"],
      where: { orgId, bizDate: { gte, lt: ltExclusive } },
      _sum: { grossTotal: true, cashTotal: true, onlineTotal: true },
    }),
    prisma.chairopsCashCollection.groupBy({
      by: ["branchId"],
      where: { orgId, collectedAt: { gte, lt: ltExclusive } },
      _sum: { depositedAmount: true },
    }),
    // Drift is a single cached snapshot per branch (not range-windowed) · used
    // as the standing shortage indicator, consistent with the rest of ChairOps.
    prisma.chairopsDrift.findMany({
      where: { orgId },
      select: { branchId: true, driftAmount: true },
    }),
  ]);

  const revByBranch = new Map(revenueRows.map((r) => [r.branchId, r._sum]));
  const legacyByBranch = new Map(legacyPosRows.map((r) => [r.branchId, r._sum]));
  const depByBranch = new Map(
    depositRows.map((r) => [r.branchId, r._sum?.depositedAmount ?? 0]),
  );
  const driftByBranch = new Map(drifts.map((d) => [d.branchId, d.driftAmount]));

  const rows: BranchPLRow[] = branches.map((b) => {
    const rev = revByBranch.get(b.id);
    const legacy = legacyByBranch.get(b.id);
    // Prefer the new aggregate; only fall back to legacy when there is NO new
    // row for this branch in the range (W0 pre-import phase or branch whose
    // POS only ever landed in the legacy table). Mixing the two would double-
    // count days that appear in both tables.
    const hasNew = rev && (decToNum(rev.grossTotal) || decToNum(rev.cashTotal));
    const revenue = decToNum(hasNew ? rev.grossTotal : legacy?.grossTotal);
    const cash = decToNum(hasNew ? rev.cashTotal : legacy?.cashTotal);
    const online = decToNum(hasNew ? rev.onlineTotal : legacy?.onlineTotal);
    const deposit = depByBranch.get(b.id) ?? 0;
    const drift = driftByBranch.get(b.id) ?? 0;

    const rentMonthly = decToNum(b.monthlyRent);
    const monthlyTotal =
      rentMonthly +
      decToNum(b.monthlyUtility) +
      decToNum(b.monthlyStaff) +
      decToNum(b.monthlyOther);
    const cost = Math.round(monthlyTotal * prorateFactor);
    const rentCost = Math.round(rentMonthly * prorateFactor);

    return {
      branchId: b.id,
      branchSlug: b.slug,
      name: b.name,
      mallGroup: b.mallGroup,
      isActive: b.isActive,
      revenue,
      cash,
      online,
      deposit,
      drift,
      cost,
      rentCost,
      net: revenue - cost,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.revenue += r.revenue;
      acc.cash += r.cash;
      acc.online += r.online;
      acc.deposit += r.deposit;
      acc.drift += r.drift;
      acc.cost += r.cost;
      acc.rentCost += r.rentCost;
      acc.net += r.net;
      return acc;
    },
    {
      revenue: 0,
      cash: 0,
      online: 0,
      deposit: 0,
      drift: 0,
      cost: 0,
      rentCost: 0,
      net: 0,
    },
  );

  return { rows, dayCount, totals };
}
