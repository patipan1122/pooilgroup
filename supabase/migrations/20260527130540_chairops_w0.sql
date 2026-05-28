-- =============================================================
-- ChairOps Wave 0 — Multi-tenant retrofit + StarThing XLSX prep
-- BIGFEATURE_chairops_SPEC §2.2 (Bug #2 + #6 fixes)
-- =============================================================
-- This migration:
--   1. Adds orgId column + index to all 16 chairops tables
--   2. Converts single-col @@unique to (orgId, ...) composite uniques
--   3. Adds 5 cost fields + secondaryAlertUserId + lastReconcileClosedAt to ChairopsBranch
--   4. Renames + widens money columns on ChairopsPosDaily (Int → Decimal(12,2))
--   5. Creates ChairopsBranchDailyRevenue (per-day aggregate)
--   6. Creates ChairopsAccessRequest (denial path required by session.ts)
--
-- Default org slug used for backfill: 'pooilgroup'  (NOT 'pool' — see prisma/seed.ts:38)
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Step 1 · Add org_id column to all 16 tables (nullable, then backfill, then NOT NULL)
-- -------------------------------------------------------------

ALTER TABLE chairops."ChairopsBranch"             ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsUser"               ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsMaidAssignment"     ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsChair"              ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsPosImport"          ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsPosDaily"           ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsCashCollection"     ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsDrift"              ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsAlert"              ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsWriteOff"           ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsDamageTicket"       ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsSparePart"          ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsSparePartMovement"  ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsCleanlinessReport"  ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsAuditLog"           ADD COLUMN IF NOT EXISTS "orgId" text;
ALTER TABLE chairops."ChairopsBankAccount"        ADD COLUMN IF NOT EXISTS "orgId" text;

-- Backfill: every existing chairops row belongs to the default org (slug='pooilgroup').
-- Pool organizations.id is uuid; cast to text for chairops.text columns.
DO $$
DECLARE
  v_org_id text;
BEGIN
  SELECT id::text INTO v_org_id FROM public.organizations WHERE slug = 'pooilgroup' LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization with slug=pooilgroup found · cannot backfill chairops.orgId';
  END IF;

  UPDATE chairops."ChairopsBranch"            SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsUser"              SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsMaidAssignment"    SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsChair"             SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsPosImport"         SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsPosDaily"          SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsCashCollection"    SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsDrift"             SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsAlert"             SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsWriteOff"          SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsDamageTicket"      SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsSparePart"         SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsSparePartMovement" SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  UPDATE chairops."ChairopsCleanlinessReport" SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  -- ChairopsAuditLog has audit_log_immutable trigger blocking UPDATE.
  -- Disable trigger only for this backfill, then re-enable. New rows from
  -- application code already pass orgId via writeAudit() helper (see lib/chairops/audit/log.ts).
  ALTER TABLE chairops."ChairopsAuditLog" DISABLE TRIGGER chairops_audit_log_immutable_update;
  UPDATE chairops."ChairopsAuditLog"          SET "orgId" = v_org_id WHERE "orgId" IS NULL;
  ALTER TABLE chairops."ChairopsAuditLog" ENABLE TRIGGER chairops_audit_log_immutable_update;
  UPDATE chairops."ChairopsBankAccount"       SET "orgId" = v_org_id WHERE "orgId" IS NULL;
END $$;

-- Enforce NOT NULL after backfill
ALTER TABLE chairops."ChairopsBranch"             ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsUser"               ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsMaidAssignment"     ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsChair"              ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsPosImport"          ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsPosDaily"           ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsCashCollection"     ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsDrift"              ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsAlert"              ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsWriteOff"           ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsDamageTicket"       ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsSparePart"          ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsSparePartMovement" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsCleanlinessReport" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsAuditLog"          ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE chairops."ChairopsBankAccount"       ALTER COLUMN "orgId" SET NOT NULL;

-- -------------------------------------------------------------
-- Step 2 · org_id indexes
-- -------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "ChairopsBranch_orgId_idx"             ON chairops."ChairopsBranch"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsUser_orgId_idx"               ON chairops."ChairopsUser"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsMaidAssignment_orgId_idx"     ON chairops."ChairopsMaidAssignment"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsChair_orgId_idx"              ON chairops."ChairopsChair"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsPosImport_orgId_idx"          ON chairops."ChairopsPosImport"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsPosDaily_orgId_idx"           ON chairops."ChairopsPosDaily"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_orgId_idx"     ON chairops."ChairopsCashCollection"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsDrift_orgId_idx"              ON chairops."ChairopsDrift"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsAlert_orgId_idx"              ON chairops."ChairopsAlert"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsWriteOff_orgId_idx"           ON chairops."ChairopsWriteOff"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsDamageTicket_orgId_idx"       ON chairops."ChairopsDamageTicket"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsSparePart_orgId_idx"          ON chairops."ChairopsSparePart"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsSparePartMovement_orgId_idx"  ON chairops."ChairopsSparePartMovement"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsCleanlinessReport_orgId_idx"  ON chairops."ChairopsCleanlinessReport"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsAuditLog_orgId_idx"           ON chairops."ChairopsAuditLog"("orgId");
CREATE INDEX IF NOT EXISTS "ChairopsBankAccount_orgId_idx"        ON chairops."ChairopsBankAccount"("orgId");

-- -------------------------------------------------------------
-- Step 3 · Drop single-col uniques · create composite (orgId, ...)
-- -------------------------------------------------------------

-- ChairopsBranch.slug · tabName
DROP INDEX IF EXISTS chairops."ChairopsBranch_slug_key";
DROP INDEX IF EXISTS chairops."ChairopsBranch_tabName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsBranch_orgId_slug_key"    ON chairops."ChairopsBranch"("orgId", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsBranch_orgId_tabName_key" ON chairops."ChairopsBranch"("orgId", "tabName");

-- ChairopsUser.authUserId · email · phone · lineUserId
DROP INDEX IF EXISTS chairops."ChairopsUser_authUserId_key";
DROP INDEX IF EXISTS chairops."ChairopsUser_email_key";
DROP INDEX IF EXISTS chairops."ChairopsUser_phone_key";
DROP INDEX IF EXISTS chairops."ChairopsUser_lineUserId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsUser_orgId_authUserId_key" ON chairops."ChairopsUser"("orgId", "authUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsUser_orgId_email_key"      ON chairops."ChairopsUser"("orgId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsUser_orgId_phone_key"      ON chairops."ChairopsUser"("orgId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsUser_orgId_lineUserId_key" ON chairops."ChairopsUser"("orgId", "lineUserId");

-- ChairopsChair.chairCode
DROP INDEX IF EXISTS chairops."ChairopsChair_chairCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsChair_orgId_chairCode_key" ON chairops."ChairopsChair"("orgId", "chairCode");

-- ChairopsPosImport.fileHash
DROP INDEX IF EXISTS chairops."ChairopsPosImport_fileHash_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsPosImport_orgId_fileHash_key" ON chairops."ChairopsPosImport"("orgId", "fileHash");

-- ChairopsPosDaily (branchId, chairCode, bizDate) · widen to (orgId, branchId, chairCode, bizDate)
DROP INDEX IF EXISTS chairops."ChairopsPosDaily_branchId_chairCode_bizDate_key";
-- Re-created later (step 5) after column rename, to use new keys consistently

-- ChairopsCashCollection.imageHash
DROP INDEX IF EXISTS chairops."ChairopsCashCollection_imageHash_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsCashCollection_orgId_imageHash_key" ON chairops."ChairopsCashCollection"("orgId", "imageHash");

-- ChairopsDrift.branchId  (was single-col unique)
DROP INDEX IF EXISTS chairops."ChairopsDrift_branchId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsDrift_orgId_branchId_key" ON chairops."ChairopsDrift"("orgId", "branchId");

-- ChairopsDamageTicket.ticketCode
DROP INDEX IF EXISTS chairops."ChairopsDamageTicket_ticketCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsDamageTicket_orgId_ticketCode_key" ON chairops."ChairopsDamageTicket"("orgId", "ticketCode");

-- ChairopsSparePart.partCode
DROP INDEX IF EXISTS chairops."ChairopsSparePart_partCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsSparePart_orgId_partCode_key" ON chairops."ChairopsSparePart"("orgId", "partCode");

-- -------------------------------------------------------------
-- Step 4 · ChairopsPosDaily money column rename + Int→Decimal widen
-- -------------------------------------------------------------
-- totalRevenue → grossTotal · cash → cashTotal · online → onlineTotal · coin → coinInsertCount
-- All cash/total columns: Int → Decimal(12,2)
-- coinInsertCount stays Int (it's a COUNT, not money)

ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "totalRevenue" TO "grossTotal";
ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "cash"         TO "cashTotal";
ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "online"       TO "onlineTotal";
ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "coin"         TO "coinInsertCount";

ALTER TABLE chairops."ChairopsPosDaily"
  ALTER COLUMN "grossTotal"  TYPE numeric(12, 2) USING "grossTotal"::numeric(12, 2),
  ALTER COLUMN "cashTotal"   TYPE numeric(12, 2) USING "cashTotal"::numeric(12, 2),
  ALTER COLUMN "onlineTotal" TYPE numeric(12, 2) USING "onlineTotal"::numeric(12, 2),
  ALTER COLUMN "totalCash"   TYPE numeric(12, 2) USING "totalCash"::numeric(12, 2);

-- (coinInsertCount keeps integer)

-- Re-create composite unique now that columns have new names
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsPosDaily_orgId_branchId_chairCode_bizDate_key"
  ON chairops."ChairopsPosDaily"("orgId", "branchId", "chairCode", "bizDate");

-- -------------------------------------------------------------
-- Step 5 · ChairopsBranch new columns (cost · alert routing · drift window anchor)
-- -------------------------------------------------------------

ALTER TABLE chairops."ChairopsBranch"
  ADD COLUMN IF NOT EXISTS "monthlyRent"          numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "monthlyUtility"       numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "monthlyStaff"         numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "monthlyOther"         numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "securityDeposit"      numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "lastReconcileClosedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "secondaryAlertUserId" text;

-- FK for secondaryAlertUserId → ChairopsUser(id)  (NO ACTION on delete · explicit clear required)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsBranch_secondaryAlertUserId_fkey'
      AND conrelid = 'chairops."ChairopsBranch"'::regclass
  ) THEN
    ALTER TABLE chairops."ChairopsBranch"
      ADD CONSTRAINT "ChairopsBranch_secondaryAlertUserId_fkey"
      FOREIGN KEY ("secondaryAlertUserId") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------
-- Step 6 · NEW table · ChairopsBranchDailyRevenue (per-branch-per-day aggregate)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chairops.chairops_branch_daily_revenue (
  "id"              text PRIMARY KEY,
  "orgId"           text NOT NULL,
  "branchId"        text NOT NULL,
  "bizDate"         date NOT NULL,
  "cashTotal"       numeric(12, 2) NOT NULL,
  "onlineTotal"     numeric(12, 2) NOT NULL,
  "otherTotal"      numeric(12, 2) NOT NULL DEFAULT 0,
  "grossTotal"      numeric(12, 2) NOT NULL,
  "paymentCount"    integer NOT NULL DEFAULT 0,
  "coinInsertCount" integer NOT NULL DEFAULT 0,
  "roundCount"      integer NOT NULL DEFAULT 0,
  "sourceImportId"  text,
  "createdAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       timestamp(3) NOT NULL,
  CONSTRAINT "chairops_branch_daily_revenue_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES chairops."ChairopsBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chairops_branch_daily_revenue_sourceImportId_fkey"
    FOREIGN KEY ("sourceImportId") REFERENCES chairops."ChairopsPosImport"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "chairops_branch_daily_revenue_orgId_branchId_bizDate_key"
  ON chairops.chairops_branch_daily_revenue ("orgId", "branchId", "bizDate");
CREATE INDEX IF NOT EXISTS "chairops_branch_daily_revenue_orgId_idx"
  ON chairops.chairops_branch_daily_revenue ("orgId");
CREATE INDEX IF NOT EXISTS "chairops_branch_daily_revenue_branchId_bizDate_idx"
  ON chairops.chairops_branch_daily_revenue ("branchId", "bizDate");

-- -------------------------------------------------------------
-- Step 7 · NEW table · ChairopsAccessRequest (denial path · SPEC §2.4)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chairops.chairops_access_request (
  "id"         text PRIMARY KEY,
  "orgId"      text NOT NULL,
  "poolUserId" text NOT NULL,
  "email"      text NOT NULL,
  "name"       text,
  "reason"     text,
  "status"     text NOT NULL DEFAULT 'PENDING',
  "createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" timestamp(3)
);

CREATE INDEX IF NOT EXISTS "chairops_access_request_orgId_idx"  ON chairops.chairops_access_request ("orgId");
CREATE INDEX IF NOT EXISTS "chairops_access_request_status_idx" ON chairops.chairops_access_request ("status");

COMMIT;

-- =============================================================
-- ROLLBACK (run in reverse order if W0 fails post-deploy)
-- =============================================================
-- BEGIN;
--
-- -- Step 7
-- DROP TABLE IF EXISTS chairops.chairops_access_request;
--
-- -- Step 6
-- DROP TABLE IF EXISTS chairops.chairops_branch_daily_revenue;
--
-- -- Step 5
-- ALTER TABLE chairops."ChairopsBranch"
--   DROP CONSTRAINT IF EXISTS "ChairopsBranch_secondaryAlertUserId_fkey";
-- ALTER TABLE chairops."ChairopsBranch"
--   DROP COLUMN IF EXISTS "monthlyRent",
--   DROP COLUMN IF EXISTS "monthlyUtility",
--   DROP COLUMN IF EXISTS "monthlyStaff",
--   DROP COLUMN IF EXISTS "monthlyOther",
--   DROP COLUMN IF EXISTS "securityDeposit",
--   DROP COLUMN IF EXISTS "lastReconcileClosedAt",
--   DROP COLUMN IF EXISTS "secondaryAlertUserId";
--
-- -- Step 4 reverse: rename columns back + cast to int
-- DROP INDEX IF EXISTS chairops."ChairopsPosDaily_orgId_branchId_chairCode_bizDate_key";
-- ALTER TABLE chairops."ChairopsPosDaily"
--   ALTER COLUMN "grossTotal"  TYPE integer USING "grossTotal"::integer,
--   ALTER COLUMN "cashTotal"   TYPE integer USING "cashTotal"::integer,
--   ALTER COLUMN "onlineTotal" TYPE integer USING "onlineTotal"::integer,
--   ALTER COLUMN "totalCash"   TYPE integer USING "totalCash"::integer;
-- ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "grossTotal"      TO "totalRevenue";
-- ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "cashTotal"       TO "cash";
-- ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "onlineTotal"     TO "online";
-- ALTER TABLE chairops."ChairopsPosDaily" RENAME COLUMN "coinInsertCount" TO "coin";
-- CREATE UNIQUE INDEX "ChairopsPosDaily_branchId_chairCode_bizDate_key"
--   ON chairops."ChairopsPosDaily"("branchId", "chairCode", "bizDate");
--
-- -- Step 3 reverse: drop composite uniques · restore single-col
-- DROP INDEX IF EXISTS chairops."ChairopsBranch_orgId_slug_key";
-- DROP INDEX IF EXISTS chairops."ChairopsBranch_orgId_tabName_key";
-- CREATE UNIQUE INDEX "ChairopsBranch_slug_key"    ON chairops."ChairopsBranch"("slug");
-- CREATE UNIQUE INDEX "ChairopsBranch_tabName_key" ON chairops."ChairopsBranch"("tabName");
-- DROP INDEX IF EXISTS chairops."ChairopsUser_orgId_authUserId_key";
-- DROP INDEX IF EXISTS chairops."ChairopsUser_orgId_email_key";
-- DROP INDEX IF EXISTS chairops."ChairopsUser_orgId_phone_key";
-- DROP INDEX IF EXISTS chairops."ChairopsUser_orgId_lineUserId_key";
-- CREATE UNIQUE INDEX "ChairopsUser_authUserId_key" ON chairops."ChairopsUser"("authUserId");
-- CREATE UNIQUE INDEX "ChairopsUser_email_key"      ON chairops."ChairopsUser"("email");
-- CREATE UNIQUE INDEX "ChairopsUser_phone_key"      ON chairops."ChairopsUser"("phone");
-- CREATE UNIQUE INDEX "ChairopsUser_lineUserId_key" ON chairops."ChairopsUser"("lineUserId");
-- DROP INDEX IF EXISTS chairops."ChairopsChair_orgId_chairCode_key";
-- CREATE UNIQUE INDEX "ChairopsChair_chairCode_key" ON chairops."ChairopsChair"("chairCode");
-- DROP INDEX IF EXISTS chairops."ChairopsPosImport_orgId_fileHash_key";
-- CREATE UNIQUE INDEX "ChairopsPosImport_fileHash_key" ON chairops."ChairopsPosImport"("fileHash");
-- DROP INDEX IF EXISTS chairops."ChairopsCashCollection_orgId_imageHash_key";
-- CREATE UNIQUE INDEX "ChairopsCashCollection_imageHash_key" ON chairops."ChairopsCashCollection"("imageHash");
-- DROP INDEX IF EXISTS chairops."ChairopsDrift_orgId_branchId_key";
-- CREATE UNIQUE INDEX "ChairopsDrift_branchId_key" ON chairops."ChairopsDrift"("branchId");
-- DROP INDEX IF EXISTS chairops."ChairopsDamageTicket_orgId_ticketCode_key";
-- CREATE UNIQUE INDEX "ChairopsDamageTicket_ticketCode_key" ON chairops."ChairopsDamageTicket"("ticketCode");
-- DROP INDEX IF EXISTS chairops."ChairopsSparePart_orgId_partCode_key";
-- CREATE UNIQUE INDEX "ChairopsSparePart_partCode_key" ON chairops."ChairopsSparePart"("partCode");
--
-- -- Step 2 reverse · drop orgId indexes
-- DROP INDEX IF EXISTS chairops."ChairopsBranch_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsUser_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsMaidAssignment_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsChair_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsPosImport_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsPosDaily_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsCashCollection_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsDrift_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsAlert_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsWriteOff_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsDamageTicket_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsSparePart_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsSparePartMovement_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsCleanlinessReport_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsAuditLog_orgId_idx";
-- DROP INDEX IF EXISTS chairops."ChairopsBankAccount_orgId_idx";
--
-- -- Step 1 reverse · drop orgId columns
-- ALTER TABLE chairops."ChairopsBranch"             DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsUser"               DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsMaidAssignment"     DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsChair"              DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsPosImport"          DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsPosDaily"           DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsCashCollection"     DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsDrift"              DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsAlert"              DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsWriteOff"           DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsDamageTicket"       DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsSparePart"          DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsSparePartMovement"  DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsCleanlinessReport" DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsAuditLog"           DROP COLUMN IF EXISTS "orgId";
-- ALTER TABLE chairops."ChairopsBankAccount"        DROP COLUMN IF EXISTS "orgId";
--
-- COMMIT;
