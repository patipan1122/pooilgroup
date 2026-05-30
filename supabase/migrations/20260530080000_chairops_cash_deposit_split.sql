-- 2026-05-30 — Cash deposit table + per-chair breakdown
--
-- CEO requirement: maid Step 1 must list ALL chairs of the branch (checklist)
-- with per-chair amount/status/photo; Step 2 deposit may BATCH multiple
-- collection rounds into one bank trip (saves fees + bank queue time) plus a
-- bankFee field.
--
-- Note: this Prisma schema uses NO @@map directives, so the Postgres tables
-- are PascalCase (`"ChairopsCashCollection"`, `"ChairopsCashDeposit"`) and
-- columns are camelCase ("orgId", "branchId", etc).

SET search_path = chairops, public;

-- 1) ChairopsCashCollection: add chairBreakdown + depositId + index
ALTER TABLE chairops."ChairopsCashCollection"
  ADD COLUMN IF NOT EXISTS "chairBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "depositId" UUID,
  ALTER COLUMN "depositedAmount" SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_branchId_depositId_idx"
  ON chairops."ChairopsCashCollection" ("branchId", "depositId");

-- 2) ChairopsCashDeposit: new table (one row per actual bank trip)
CREATE TABLE IF NOT EXISTS chairops."ChairopsCashDeposit" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"           UUID NOT NULL,
  "branchId"        UUID NOT NULL,
  "maidId"          UUID NOT NULL,
  "depositedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "depositedAmount" INTEGER NOT NULL,
  "bankFee"         INTEGER NOT NULL DEFAULT 0,
  "slipPhotoUrl"    TEXT NOT NULL,
  "slipImageHash"   TEXT NOT NULL,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChairopsCashDeposit_orgId_slipImageHash_key"
    UNIQUE ("orgId", "slipImageHash")
);

CREATE INDEX IF NOT EXISTS "ChairopsCashDeposit_orgId_idx"
  ON chairops."ChairopsCashDeposit" ("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsCashDeposit_branchId_depositedAt_idx"
  ON chairops."ChairopsCashDeposit" ("branchId", "depositedAt");
CREATE INDEX IF NOT EXISTS "ChairopsCashDeposit_maidId_depositedAt_idx"
  ON chairops."ChairopsCashDeposit" ("maidId", "depositedAt");

-- 3) FKs (use DO block to skip if already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsCashCollection_depositId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsCashCollection"
      ADD CONSTRAINT "ChairopsCashCollection_depositId_fkey"
      FOREIGN KEY ("depositId") REFERENCES chairops."ChairopsCashDeposit"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsCashDeposit_branchId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsCashDeposit"
      ADD CONSTRAINT "ChairopsCashDeposit_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsCashDeposit_maidId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsCashDeposit"
      ADD CONSTRAINT "ChairopsCashDeposit_maidId_fkey"
      FOREIGN KEY ("maidId") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
