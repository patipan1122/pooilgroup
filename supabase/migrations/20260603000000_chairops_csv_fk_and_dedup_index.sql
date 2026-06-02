-- =============================================================
-- ChairOps F1 follow-up · audit P0/P1 fixes (2026-06-03)
-- =============================================================
-- Closes audit findings SA-1, SA-2, BA-01, BA-02, QA-02, DEVIL-01:
--
--   (a) Add the missing FK from ChairopsCashCollection.importedById →
--       ChairopsUser.id with ON DELETE SET NULL so deleting the admin
--       who pasted a CSV nulls out the audit pointer instead of leaving
--       a dangling text id. (SA-1)
--
--   (b) Add a partial UNIQUE INDEX on
--       (orgId, branchId, date_trunc('minute', collectedAt), countedAmount)
--       WHERE source = 'CSV_IMPORT' so concurrent CSV pastes can't
--       silently double-count cash collections — even when app-layer
--       dedup races. (SA-2, BA-01, QA-02, DEVIL-01)
--
-- DO NOT APPLY directly · CEO runs `supabase db push` manually after
-- this PR ships (per [[wave-migration-written-not-applied-trap]]).
-- =============================================================

BEGIN;

SET search_path = chairops, public;

-- -------------------------------------------------------------
-- (a) FK importedById → ChairopsUser (id) · SET NULL on delete
-- -------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsCashCollection_importedById_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsCashCollection"
      ADD CONSTRAINT "ChairopsCashCollection_importedById_fkey"
      FOREIGN KEY ("importedById") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------
-- (b) CSV dedup partial unique index
--     Natural CSV identity = (orgId, branchId, minute-bucket of
--     collectedAt, countedAmount). MAID_MANUAL rows are excluded
--     because they're already deduped by (orgId, imageHash) — the
--     existing unique index continues to cover that path.
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsCashCollection_csv_dedup_uniq"
  ON chairops."ChairopsCashCollection"
  ("orgId", "branchId", date_trunc('minute', "collectedAt"), "countedAmount")
  WHERE "source" = 'CSV_IMPORT';

COMMIT;
