// ============================================================
// Canonical deposit-read helper (CEO 2026-06-02 P0 · orchestra audit)
// ============================================================
// AFTER Wave-2 (2026-05-30) maid deposits moved from a per-collection-row
// column (`ChairopsCashCollection.depositedAmount`) to a separate
// `ChairopsCashDeposit` table (one row per bank trip, can cover N collections).
// New collections written by the maid LIFF have `depositedAmount = 0` —
// the value lives on the linked CashDeposit row instead.
//
// `lib/chairops/reconcile/drift-engine.ts:103-152` is the canonical formula
// owner. This module exposes that exact union for surfaces other than the
// drift-engine, so the sidebar / KPIs / sparkbars all match the engine
// (CEO complaint: "ทำไม sidebar -22,761 แต่ home tile -7,920").
//
// Formula (re-stated for reviewers):
//   deposits = Σ ChairopsCashDeposit.depositedAmount
//            + Σ ChairopsCashDeposit.bankFee                      ← bank fee
//            + Σ ChairopsCashCollection.depositedAmount
//              WHERE depositId IS NULL AND depositedAmount > 0    ← legacy
//
// SCOPE: read-only. Does NOT touch drift-engine itself. Maid LIFF write paths
// are unaffected (they write `countedAmount` → CashDeposit row, never the
// dead column).
//
// References: [[chairops-no-cumulative-shortage]] ·
//   [[chairops-reconcile-window-noon-to-noon]]
// ============================================================

import { prisma } from "@/lib/prisma";

interface RangeArgs {
  orgId: string;
  /** Filter to a single branch · omit for whole-org. */
  branchId?: string;
  /** Filter to a list of branches · cheaper than calling per-branch. */
  branchIds?: string[];
  /** Inclusive lower bound (UTC). */
  since?: Date;
  /** Exclusive upper bound (UTC). */
  until?: Date;
}

function buildDepositWhere(args: RangeArgs) {
  const { orgId, branchId, branchIds, since, until } = args;
  const where: {
    orgId: string;
    branchId?: string | { in: string[] };
    depositedAt?: { gte?: Date; lt?: Date };
  } = { orgId };
  if (branchId) where.branchId = branchId;
  else if (branchIds && branchIds.length > 0) where.branchId = { in: branchIds };
  if (since || until) {
    where.depositedAt = {};
    if (since) where.depositedAt.gte = since;
    if (until) where.depositedAt.lt = until;
  }
  return where;
}

function buildLegacyCollectionWhere(args: RangeArgs) {
  const { orgId, branchId, branchIds, since, until } = args;
  const where: {
    orgId: string;
    branchId?: string | { in: string[] };
    depositId: null;
    depositedAmount: { gt: number };
    collectedAt?: { gte?: Date; lt?: Date };
  } = {
    orgId,
    depositId: null,
    depositedAmount: { gt: 0 },
  };
  if (branchId) where.branchId = branchId;
  else if (branchIds && branchIds.length > 0) where.branchId = { in: branchIds };
  if (since || until) {
    where.collectedAt = {};
    if (since) where.collectedAt.gte = since;
    if (until) where.collectedAt.lt = until;
  }
  return where;
}

function isoDay(d: Date): string {
  // Bangkok-local day grain (matches reconcile-v2 + branches-workspace).
  return d.toISOString().slice(0, 10);
}

/**
 * Σ deposits per branch within a date range (matches drift-engine formula).
 * Returns Map<branchId, totalBaht>. Branches with zero deposits are OMITTED
 * (caller can default to 0).
 *
 * Example: today's per-branch deposit totals →
 *   getDepositsInRange({ orgId, since: startOfToday() })
 */
export async function getDepositsInRange(
  args: RangeArgs,
): Promise<Map<string, number>> {
  const [deposits, legacyCollections] = await Promise.all([
    prisma.chairopsCashDeposit.groupBy({
      by: ["branchId"],
      where: buildDepositWhere(args),
      _sum: { depositedAmount: true, bankFee: true },
    }),
    prisma.chairopsCashCollection.groupBy({
      by: ["branchId"],
      where: buildLegacyCollectionWhere(args),
      _sum: { depositedAmount: true },
    }),
  ]);

  const out = new Map<string, number>();
  for (const r of deposits) {
    const amt =
      (r._sum?.depositedAmount ?? 0) + (r._sum?.bankFee ?? 0);
    if (amt !== 0) out.set(r.branchId, (out.get(r.branchId) ?? 0) + amt);
  }
  for (const r of legacyCollections) {
    const amt = r._sum?.depositedAmount ?? 0;
    if (amt !== 0) out.set(r.branchId, (out.get(r.branchId) ?? 0) + amt);
  }
  return out;
}

/**
 * Σ deposits per day for ONE branch (or whole org if branchId omitted).
 * Returns Map<"YYYY-MM-DD", totalBaht>. Days with zero deposits are OMITTED.
 * Day key = depositedAt (new) or collectedAt (legacy) at UTC-ISO date.
 *
 * Example: ledger view for one branch over 30 days →
 *   getDepositsByDate({ orgId, branchId, since: startOfDayMinus(30) })
 */
export async function getDepositsByDate(args: {
  orgId: string;
  branchId?: string;
  since?: Date;
  until?: Date;
}): Promise<Map<string, number>> {
  const depositWhere = buildDepositWhere(args);
  const legacyWhere = buildLegacyCollectionWhere(args);

  const [deposits, legacyCollections] = await Promise.all([
    prisma.chairopsCashDeposit.findMany({
      where: depositWhere,
      select: { depositedAt: true, depositedAmount: true, bankFee: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: legacyWhere,
      select: { collectedAt: true, depositedAmount: true },
    }),
  ]);

  const out = new Map<string, number>();
  for (const d of deposits) {
    const key = isoDay(d.depositedAt);
    const amt = d.depositedAmount + d.bankFee;
    if (amt !== 0) out.set(key, (out.get(key) ?? 0) + amt);
  }
  for (const c of legacyCollections) {
    const key = isoDay(c.collectedAt);
    const amt = c.depositedAmount;
    if (amt !== 0) out.set(key, (out.get(key) ?? 0) + amt);
  }
  return out;
}

/**
 * Σ deposits per (branch, day) — used by surfaces that render a 7-day
 * sparkbar for many branches in one query (no N+1).
 * Returns Map<branchId, Map<"YYYY-MM-DD", baht>>.
 */
export async function getDepositsByBranchAndDate(args: {
  orgId: string;
  branchIds?: string[];
  since?: Date;
  until?: Date;
}): Promise<Map<string, Map<string, number>>> {
  const depositWhere = buildDepositWhere(args);
  const legacyWhere = buildLegacyCollectionWhere(args);

  const [deposits, legacyCollections] = await Promise.all([
    prisma.chairopsCashDeposit.findMany({
      where: depositWhere,
      select: {
        branchId: true,
        depositedAt: true,
        depositedAmount: true,
        bankFee: true,
      },
    }),
    prisma.chairopsCashCollection.findMany({
      where: legacyWhere,
      select: {
        branchId: true,
        collectedAt: true,
        depositedAmount: true,
      },
    }),
  ]);

  const out = new Map<string, Map<string, number>>();
  function add(branchId: string, key: string, amt: number) {
    if (amt === 0) return;
    let inner = out.get(branchId);
    if (!inner) {
      inner = new Map<string, number>();
      out.set(branchId, inner);
    }
    inner.set(key, (inner.get(key) ?? 0) + amt);
  }
  for (const d of deposits) {
    add(d.branchId, isoDay(d.depositedAt), d.depositedAmount + d.bankFee);
  }
  for (const c of legacyCollections) {
    add(c.branchId, isoDay(c.collectedAt), c.depositedAmount);
  }
  return out;
}
