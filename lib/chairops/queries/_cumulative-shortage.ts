// Canonical "cumulative shortage" helper — single source of truth for the
// "ค้างฝากรวม" number shown across the exec home, reconcile hero, and the
// reconcile sidebar org row.
//
// CEO ruling 2026-06-02 (orchestra-audit CONF-05 / row #3):
//   The aggregate number must be a POSITIVE-ONLY SUM of `driftAmount` across
//   all active branches — i.e. "how much cash is the office still waiting on,
//   summed across every branch that owes". This matches the mental model
//   the CEO uses when reading the exec home tile "ค้างฝากรวมทุกสาขา".
//
//   Surplus branches (driftAmount < 0 = office holding more than POS expected)
//   DO NOT cancel out shortage branches in this aggregate, because a surplus
//   in one branch does not pay back a shortage in another — they are separate
//   ledgers. Per-row drift signs are unaffected; only the AGGREGATE changes.
//
// History:
//   - exec-home.ts used positive-only (correct)
//   - reconcile-shell.tsx used signed net (wrong: opposite sign from exec home)
//   - reconcile-v2.ts used last-day cumDrift from ledger replay (also wrong)
//   - 3 surfaces → 3 different numbers for the same KPI → CEO didn't trust any
//
// This helper centralises the calculation so all 3 surfaces converge.

import { getDashboardRows } from "@/lib/chairops/reconcile/drift-engine";

export interface CumulativeShortageResult {
  /**
   * Sum of positive `driftAmount` across active branches (THB).
   *
   * Always ≥ 0. Represents total cash the office is waiting on, aggregated
   * across branches that owe. Surplus branches are excluded from the sum
   * (a surplus in branch A does not cancel a shortage in branch B).
   */
  total: number;
  /** Number of active branches with driftAmount > 0. */
  shortageBranchCount: number;
  /** Number of active branches total (denominator for ratios). */
  activeBranchCount: number;
}

/**
 * Returns the canonical "ค้างฝากรวมทุกสาขา" total for an org.
 *
 * Use this from any surface that needs to display the aggregate cumulative
 * shortage. Per-row drift chips/cells must stay signed — only the AGGREGATE
 * uses positive-only summation.
 */
export async function getCumulativeShortage(
  orgId: string,
): Promise<CumulativeShortageResult> {
  const rows = await getDashboardRows(orgId);
  const active = rows.filter((r) => r.isActive);
  const total = active.reduce(
    (sum, r) => sum + (r.driftAmount > 0 ? r.driftAmount : 0),
    0,
  );
  const shortageBranchCount = active.filter((r) => r.driftAmount > 0).length;
  return {
    total,
    shortageBranchCount,
    activeBranchCount: active.length,
  };
}
