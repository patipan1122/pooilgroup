-- =============================================================
-- ChairOps · Timestamped POS event ingestion (Plan B)
-- =============================================================
-- Two new tables in the `chairops` schema holding per-second cash & coin
-- events exported from the StarThing portal. These unlock per-maid-collection
-- noon-window reconcile (which the daily-summary table cannot do — it has no
-- timestamps).
--
-- CEO #1 requirement: ROW-LEVEL DEDUP. The CEO re-uploads overlapping date
-- ranges and must NOT double-count. Each row carries a `rowHash` =
-- sha256(device | eventAtISO | amount | meter); a UNIQUE INDEX on
-- (orgId, rowHash) makes re-ingesting the same event a no-op (skipDuplicates).
--
-- Column types match the Prisma models EXACTLY:
--   text ids (cuid) · timestamptz(6) eventAt · numeric(12,2) cash · integer coin.
-- FKs: branchId → ChairopsBranch(id) ON DELETE SET NULL (branch may be unmatched
-- or deleted) · sourceImportId → ChairopsPosImport(id) ON DELETE SET NULL.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS · FKs added via guarded DO block.
-- DO NOT apply blindly — parent agent briefs CEO + applies. ROLLBACK at bottom.

BEGIN;

-- -------------------------------------------------------------
-- Step 1 · ChairopsPosCashEvent
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chairops.chairops_pos_cash_event (
  "id"             text PRIMARY KEY,
  "orgId"          text NOT NULL,
  "branchId"       text,
  "chairDeviceId"  text NOT NULL,
  "chairNumber"    text,
  "storeName"      text NOT NULL,
  "eventAt"        timestamptz(6) NOT NULL,
  "cashAdded"      numeric(12, 2) NOT NULL,
  "cashMeter"      numeric(12, 2) NOT NULL,
  "rowHash"        text NOT NULL,
  "sourceImportId" text,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Row-level dedup guard (CEO #1 requirement) — re-uploading the same event no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS "chairops_pos_cash_event_orgId_rowHash_key"
  ON chairops.chairops_pos_cash_event ("orgId", "rowHash");
CREATE INDEX IF NOT EXISTS "chairops_pos_cash_event_orgId_branchId_eventAt_idx"
  ON chairops.chairops_pos_cash_event ("orgId", "branchId", "eventAt");
CREATE INDEX IF NOT EXISTS "chairops_pos_cash_event_orgId_eventAt_idx"
  ON chairops.chairops_pos_cash_event ("orgId", "eventAt");

-- FKs (guarded so the migration is re-runnable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chairops_pos_cash_event_branchId_fkey'
  ) THEN
    ALTER TABLE chairops.chairops_pos_cash_event
      ADD CONSTRAINT "chairops_pos_cash_event_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chairops_pos_cash_event_sourceImportId_fkey'
  ) THEN
    ALTER TABLE chairops.chairops_pos_cash_event
      ADD CONSTRAINT "chairops_pos_cash_event_sourceImportId_fkey"
      FOREIGN KEY ("sourceImportId") REFERENCES chairops."ChairopsPosImport"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------
-- Step 2 · ChairopsPosCoinEvent
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chairops.chairops_pos_coin_event (
  "id"             text PRIMARY KEY,
  "orgId"          text NOT NULL,
  "branchId"       text,
  "chairDeviceId"  text NOT NULL,
  "chairNumber"    text,
  "storeName"      text NOT NULL,
  "eventAt"        timestamptz(6) NOT NULL,
  "coinAdded"      integer NOT NULL,
  "coinMeter"      integer NOT NULL,
  "rowHash"        text NOT NULL,
  "sourceImportId" text,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "chairops_pos_coin_event_orgId_rowHash_key"
  ON chairops.chairops_pos_coin_event ("orgId", "rowHash");
CREATE INDEX IF NOT EXISTS "chairops_pos_coin_event_orgId_branchId_eventAt_idx"
  ON chairops.chairops_pos_coin_event ("orgId", "branchId", "eventAt");
CREATE INDEX IF NOT EXISTS "chairops_pos_coin_event_orgId_eventAt_idx"
  ON chairops.chairops_pos_coin_event ("orgId", "eventAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chairops_pos_coin_event_branchId_fkey'
  ) THEN
    ALTER TABLE chairops.chairops_pos_coin_event
      ADD CONSTRAINT "chairops_pos_coin_event_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chairops_pos_coin_event_sourceImportId_fkey'
  ) THEN
    ALTER TABLE chairops.chairops_pos_coin_event
      ADD CONSTRAINT "chairops_pos_coin_event_sourceImportId_fkey"
      FOREIGN KEY ("sourceImportId") REFERENCES chairops."ChairopsPosImport"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- =============================================================
-- ROLLBACK (run in reverse order if this migration fails post-deploy)
-- =============================================================
-- BEGIN;
--
-- -- Step 2
-- DROP TABLE IF EXISTS chairops.chairops_pos_coin_event;
--
-- -- Step 1
-- DROP TABLE IF EXISTS chairops.chairops_pos_cash_event;
--
-- COMMIT;
