-- ChairOps · CSV-import history + reversible (soft) delete
-- CEO 2026-06-30: super_admin must SEE every CSV import in one place and be
-- able to UNDO a wrong import (whole batch or single row) without losing
-- evidence. Adds an import-batch grouping key + soft-delete columns to
-- ChairopsCashCollection. Additive only — old rows keep working (all new
-- columns are nullable). Apply BEFORE redeploy (schema-gate enforces presence
-- of these columns on Vercel build).

ALTER TABLE "chairops"."ChairopsCashCollection"
  ADD COLUMN IF NOT EXISTS "importBatchId" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "deleteReason"  TEXT;

-- History page groups by importBatchId; ledger/period/drift queries filter
-- deletedAt IS NULL per branch — index both so the added WHERE stays cheap.
CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_importBatchId_idx"
  ON "chairops"."ChairopsCashCollection" ("importBatchId");

CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_branchId_deletedAt_idx"
  ON "chairops"."ChairopsCashCollection" ("branchId", "deletedAt");
