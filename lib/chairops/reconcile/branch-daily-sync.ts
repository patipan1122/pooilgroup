// Self-heal: keep chairops_branch_daily_revenue consistent with ChairopsPosDaily.
//
// 2026-07-04 incident: branch_daily_revenue (the table drift + ledger read for
// daily sales) is written by a SEPARATE storeName-matched aggregate in the
// importer (pos-ingest/actions.ts SPEC §2.5 · XLSX-only) — so a storeName that
// failed to resolve to a branch silently dropped the branch-level rollup, while
// ChairopsPosDaily (per-chair, resolved via normalizeStoreKey + manual override)
// stayed complete. 12 branches lost Apr–Jun sales in branch_daily → drift showed
// a bogus "over-deposit". See [[chairops-branch-daily-revenue-gap-and-writeoff-
// entanglement-2026-07-04]].
//
// This backfills any (orgId, branchId, bizDate) that ChairopsPosDaily has but
// branch_daily_revenue is missing. It is:
//   • INSERT-ONLY + ON CONFLICT DO NOTHING → never overwrites a real import row,
//     idempotent, safe to run on every cron tick (heals 0 rows in steady state).
//   • coin-free grossTotal (= cash + online) to match the StarThing convention —
//     readers re-add coin via coinInsertCount × COIN_BAHT, so SUMming PosDaily's
//     own grossTotal (which bakes coin in) would double-count. Do NOT change this.
//   • chairCode IS NOT NULL → ignores any unattributed placeholder rows.
// Only the 4 columns the drift/ledger engine actually reads (cashTotal, onlineTotal,
// coinInsertCount, grossTotal) carry real values; other/payment/round default 0.

import { prisma } from "@/lib/prisma";

/**
 * Backfill branch_daily_revenue rows that ChairopsPosDaily has but the branch
 * rollup is missing. Returns the number of (branch, day) rows healed — 0 in the
 * healthy steady state; > 0 means the importer silently dropped a branch rollup
 * and this closed the gap (a signal worth surfacing).
 */
export async function syncBranchDailyFromPosDaily(): Promise<number> {
  const healed = await prisma.$executeRaw`
    INSERT INTO chairops.chairops_branch_daily_revenue
      (id, "orgId", "branchId", "bizDate",
       "cashTotal", "onlineTotal", "otherTotal", "grossTotal",
       "paymentCount", "coinInsertCount", "roundCount",
       "sourceImportId", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text, d."orgId", d."branchId", d."bizDate",
      COALESCE(SUM(d."cashTotal"), 0),
      COALESCE(SUM(d."onlineTotal"), 0),
      0,
      COALESCE(SUM(d."cashTotal"), 0) + COALESCE(SUM(d."onlineTotal"), 0),
      0,
      COALESCE(SUM(d."coinInsertCount"), 0),
      0,
      NULL, now(), now()
    FROM chairops."ChairopsPosDaily" d
    WHERE d."chairCode" IS NOT NULL
    GROUP BY d."orgId", d."branchId", d."bizDate"
    ON CONFLICT ("orgId", "branchId", "bizDate") DO NOTHING
  `;
  return healed;
}
