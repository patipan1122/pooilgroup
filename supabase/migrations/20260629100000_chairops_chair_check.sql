-- CEO 2026-06-29 · "ตู้เสีย" triage + log
-- Adds ChairopsChairCheck (per chair+device triage state) and
-- ChairopsChairCheckLog (append-only history). Additive + idempotent.

DO $$ BEGIN
  CREATE TYPE "chairops"."ChairopsChairCheckStatus" AS ENUM (
    'PENDING','CHECKING','MAID_SCHEDULED','REPAIR_REPORTED','PARTS_SENT','RESOLVED','FALSE_ALARM'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "chairops"."ChairopsChairCheck" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "chairId" TEXT NOT NULL,
  "chairCode" TEXT NOT NULL,
  "stream" TEXT NOT NULL,
  "streamKey" TEXT NOT NULL,
  "status" "chairops"."ChairopsChairCheckStatus" NOT NULL DEFAULT 'PENDING',
  "linkedTicketId" TEXT,
  "note" TEXT,
  "lastActionById" TEXT,
  "lastActionByName" TEXT,
  "lastActionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChairopsChairCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsChairCheck_orgId_streamKey_key"
  ON "chairops"."ChairopsChairCheck"("orgId","streamKey");
CREATE INDEX IF NOT EXISTS "ChairopsChairCheck_orgId_branchId_idx"
  ON "chairops"."ChairopsChairCheck"("orgId","branchId");
CREATE INDEX IF NOT EXISTS "ChairopsChairCheck_orgId_status_idx"
  ON "chairops"."ChairopsChairCheck"("orgId","status");
CREATE INDEX IF NOT EXISTS "ChairopsChairCheck_orgId_chairCode_idx"
  ON "chairops"."ChairopsChairCheck"("orgId","chairCode");

CREATE TABLE IF NOT EXISTS "chairops"."ChairopsChairCheckLog" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "checkId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "note" TEXT,
  "byUserId" TEXT,
  "byName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChairopsChairCheckLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChairopsChairCheckLog_orgId_checkId_createdAt_idx"
  ON "chairops"."ChairopsChairCheckLog"("orgId","checkId","createdAt");

DO $$ BEGIN
  ALTER TABLE "chairops"."ChairopsChairCheckLog"
    ADD CONSTRAINT "ChairopsChairCheckLog_checkId_fkey"
    FOREIGN KEY ("checkId") REFERENCES "chairops"."ChairopsChairCheck"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
