-- =============================================================
-- ChairOps · CSV/OFFICE dedup index fix (2026-07-02)
-- =============================================================
-- Deep-review P0 #2 + P1 #11 (chairops-deep-review-new-fraud-cluster-2026-07-01):
--
--   The dedup unique index added in 20260603000000 was
--     (orgId, branchId, minute(collectedAt), countedAmount) WHERE source='CSV_IMPORT'
--
--   Two holes:
--   (a) It counts SOFT-DELETED rows. After a batch is soft-deleted from the
--       import-history page, re-importing the SAME file collides with the
--       tombstone rows → createMany(skipDuplicates) silently drops them →
--       the cash never comes back ("ข้ามเพราะซ้ำ"). Money lost, no error. (P0)
--   (b) OFFICE_PROXY rows (office-keyed-on-behalf collections) are NOT covered,
--       so two tabs committing the same office batch concurrently double-count. (P1)
--
--   Fix: drop + recreate the index so it (a) ignores deletedAt rows and
--   (b) covers OFFICE_PROXY in addition to CSV_IMPORT. MAID_MANUAL stays
--   excluded (it dedups via (orgId, imageHash) + the new clientRequestId path).
--
-- ⚠️ If this CREATE fails with a unique_violation, prod already holds live
--    (non-deleted) OFFICE_PROXY duplicates that predate any guard — tell Claude
--    and we add a targeted dedup step before re-running. It changes nothing on
--    failure (wrapped in a transaction).
--
-- DO NOT APPLY directly · CEO runs `supabase db push` / psql manually after
-- this ships (per [[wave-migration-written-not-applied-trap]]).
-- =============================================================

BEGIN;

SET search_path = chairops, public;

DROP INDEX IF EXISTS chairops."ChairopsCashCollection_csv_dedup_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsCashCollection_csv_dedup_uniq"
  ON chairops."ChairopsCashCollection"
  ("orgId", "branchId", date_trunc('minute', "collectedAt"), "countedAmount")
  WHERE "source" IN ('CSV_IMPORT', 'OFFICE_PROXY') AND "deletedAt" IS NULL;

COMMIT;
