-- 2026-05-31 — Chair move history table
--
-- CEO 2026-05-31: เก้าอี้ย้ายสาขาได้จริง · ต้องเห็นประวัติว่าตัวไหนเคยอยู่ที่ไหนเมื่อไหร่.
-- Revenue rows (PosDaily / CashCollection / BranchDailyRevenue) already snapshot
-- branchId at event time so historical revenue stays attached to the original
-- branch. This table is purely for "where has chair G0322099 been" lookups,
-- queried by chairId or by toBranchId.
--
-- All id columns are TEXT to match existing chairops schema convention.
-- Prisma supplies the @default(uuid()) value at insert time.

SET search_path = chairops, public;

CREATE TABLE IF NOT EXISTS chairops."ChairopsChairMove" (
  "id"           TEXT PRIMARY KEY,
  "orgId"        TEXT NOT NULL,
  "chairId"      TEXT NOT NULL,
  "fromBranchId" TEXT,
  "toBranchId"   TEXT NOT NULL,
  "movedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "movedById"    TEXT,
  "source"       TEXT NOT NULL DEFAULT 'manual',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ChairopsChairMove_orgId_idx"
  ON chairops."ChairopsChairMove" ("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsChairMove_chairId_movedAt_idx"
  ON chairops."ChairopsChairMove" ("chairId", "movedAt");
CREATE INDEX IF NOT EXISTS "ChairopsChairMove_toBranchId_movedAt_idx"
  ON chairops."ChairopsChairMove" ("toBranchId", "movedAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsChairMove_chairId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsChairMove"
      ADD CONSTRAINT "ChairopsChairMove_chairId_fkey"
      FOREIGN KEY ("chairId") REFERENCES chairops."ChairopsChair"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsChairMove_fromBranchId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsChairMove"
      ADD CONSTRAINT "ChairopsChairMove_fromBranchId_fkey"
      FOREIGN KEY ("fromBranchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsChairMove_toBranchId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsChairMove"
      ADD CONSTRAINT "ChairopsChairMove_toBranchId_fkey"
      FOREIGN KEY ("toBranchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsChairMove_movedById_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsChairMove"
      ADD CONSTRAINT "ChairopsChairMove_movedById_fkey"
      FOREIGN KEY ("movedById") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
