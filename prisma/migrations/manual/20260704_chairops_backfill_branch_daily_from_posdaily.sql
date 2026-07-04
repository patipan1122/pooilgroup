-- 2026-07-04 · Restore missing chairops_branch_daily_revenue (sales) from ChairopsPosDaily
-- ---------------------------------------------------------------------------
-- APPLIED MANUALLY to prod on 2026-07-04 (psql DIRECT_URL) → INSERT 1,050 rows.
-- Committed here for the record; safe to re-run (idempotent, insert-only).
--
-- ROOT CAUSE: branch_daily_revenue (drift + ledger read this for daily sales) is
-- written by a SEPARATE storeName-matched aggregate in the importer, so files
-- like "Ck plaza (200)" that didn't resolve to a branch silently dropped the
-- branch rollup — while ChairopsPosDaily (per-chair, resolved via normalizeStoreKey)
-- stayed complete. 12 branches lost Apr–Jun sales in branch_daily → drift showed
-- a bogus over-deposit. The normalizeStoreKey fix (3edf27f6) is forward-only and
-- does NOT backfill. Physical machine meters confirm ChairopsPosDaily is correct.
--
-- SAFETY: SALES-ONLY. Does NOT touch deposits, collections, or write-offs.
--   * grossTotal = cash + online (COIN-FREE) — readers re-add coin via
--     coinInsertCount × COIN_BAHT; SUMming PosDaily.grossTotal would double-count.
--   * chairCode IS NOT NULL — ignore unattributed placeholder rows.
--   * ON CONFLICT (orgId,branchId,bizDate) DO NOTHING — never overwrites an
--     existing (real import) row; only fills the gap. Idempotent, re-runnable.
--   * Only the 4 engine-read columns carry real values; other/payment/round = 0.
--
-- Going forward this is enforced by lib/chairops/reconcile/branch-daily-sync.ts
-- (syncBranchDailyFromPosDaily), called on every POS import commit AND every
-- recompute-drifts cron tick — so branch_daily can never silently diverge again.
-- ---------------------------------------------------------------------------

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
ON CONFLICT ("orgId", "branchId", "bizDate") DO NOTHING;
