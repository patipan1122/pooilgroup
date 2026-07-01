-- 2026-07-01 · ChairOps · Re-link orphaned POS events to their branches
-- ---------------------------------------------------------------------------
-- ROOT CAUSE: storeName -> branch resolution matched EXACT `ChairopsBranch.name`,
-- but StarThing EVENT exports carry a trailing store-code suffix like " (200)"
-- that the branch name may omit (file "Ck plaza (200)"  vs  branch "Ck plaza").
-- Result: ~77% (19,290 / 25,126) of cash events had branchId = NULL, so the
-- per-chair time-windowed anti-fraud view (getReconcilePerChairTW) showed ⚪ and
-- could not compare maid-collected cash against meter deltas.
--
-- FIX: back-link branchId by a NORMALIZED name key — strip a trailing "(digits)"
-- code, lowercase, collapse whitespace. This normalization is IDENTICAL to the
-- TypeScript `normalizeStoreKey()` in lib/chairops/pos-ingest/event-diff.ts.
--
-- SAFETY (verified against origin/setup code):
--   * Event tables feed ONLY getReconcilePerChairTW (the anti-fraud view).
--     Drift, write-offs, and the "รอบเก็บ (Periods)" view read the daily-aggregate
--     tables (ChairopsBranchDailyRevenue / ChairopsPosDaily) — UNTOUCHED here.
--   * branchId is NOT part of rowHash (sha256 of device|eventAt|amount|meter),
--     so updating it cannot create/break dedup rows. Idempotent + re-runnable.
--   * Only keys mapping to EXACTLY ONE branch are linked. Ambiguous keys
--     (duplicate branch records) and no-match keys (file typos) stay NULL for
--     manual handling — we never guess which branch a row belongs to.
--   * storeName is preserved on every row, so this is fully reversible.
-- ---------------------------------------------------------------------------

BEGIN;

-- Normalized branch key -> single branch id (only keys owned by exactly one branch).
CREATE TEMP TABLE _branch_key ON COMMIT DROP AS
SELECT "orgId",
       btrim(regexp_replace(
         regexp_replace(lower(name), '\s*\(\s*\d+\s*\)\s*$', ''),
         '\s+', ' ', 'g')) AS nkey,
       min(id) AS bid,
       count(*) AS n
FROM chairops."ChairopsBranch"
GROUP BY "orgId",
         btrim(regexp_replace(
           regexp_replace(lower(name), '\s*\(\s*\d+\s*\)\s*$', ''),
           '\s+', ' ', 'g'));

-- CASH events
UPDATE chairops.chairops_pos_cash_event e
SET "branchId" = bk.bid
FROM _branch_key bk
WHERE e."branchId" IS NULL
  AND bk.n = 1
  AND bk."orgId" = e."orgId"
  AND btrim(regexp_replace(
        regexp_replace(lower(e."storeName"), '\s*\(\s*\d+\s*\)\s*$', ''),
        '\s+', ' ', 'g')) = bk.nkey;

-- COIN events
UPDATE chairops.chairops_pos_coin_event e
SET "branchId" = bk.bid
FROM _branch_key bk
WHERE e."branchId" IS NULL
  AND bk.n = 1
  AND bk."orgId" = e."orgId"
  AND btrim(regexp_replace(
        regexp_replace(lower(e."storeName"), '\s*\(\s*\d+\s*\)\s*$', ''),
        '\s+', ' ', 'g')) = bk.nkey;

-- Report what remains unlinked (typos + ambiguous dup branches) for follow-up.
SELECT 'cash_still_orphan' AS k, count(*) AS n FROM chairops.chairops_pos_cash_event WHERE "branchId" IS NULL
UNION ALL
SELECT 'coin_still_orphan', count(*) FROM chairops.chairops_pos_coin_event WHERE "branchId" IS NULL;

COMMIT;
