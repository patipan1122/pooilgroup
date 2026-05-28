-- =============================================================
-- ChairOps Wave 0 REMAINDER — only the steps that step 1 didn't complete
-- =============================================================
-- The original 20260527130540_chairops_w0.sql aborted at line 168
-- (RENAME totalRevenue → grossTotal · column already renamed in a prior run).
-- All steps 1-5 are already applied per psql introspection 2026-05-28.
-- This file applies only steps 6 + 7 + the post-rename composite unique.
-- Idempotent · safe to re-run.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Step 4 tail · re-create composite unique on the (already-renamed) columns
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsPosDaily_orgId_branchId_chairCode_bizDate_key"
  ON chairops."ChairopsPosDaily"("orgId", "branchId", "chairCode", "bizDate");

-- -------------------------------------------------------------
-- Step 6 · ChairopsBranchDailyRevenue (per-branch-per-day aggregate)
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
-- Step 7 · ChairopsAccessRequest (denial path)
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
