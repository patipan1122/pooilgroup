-- Pooilgroup ERP — Migration: Companies + Sub-tenant rentals + 4 new business types
-- Date: 2026-05-05
--
-- Adds:
--   1. companies table (Pooil Oil + JP Sync legal entities under one org)
--   2. branches.company_id + branches.parent_branch_id (sub-tenant model)
--   3. branch_rentals table (rental contracts: fixed / percentage / mixed)
--   4. New BusinessType values: lpg_retail, cafe_punthai, massage_chair, claw_machine, training_center
--   5. New UserRole values: admin, area_manager
--   6. users.employee_code (Humansoft HR reference)
--   7. daily_reports.rental_income + daily_reports.training_sessions
--
-- Run AFTER setup.sql + 20260504000001_rls_and_jwt_claim.sql have been applied.
-- Idempotent — safe to re-run.
--
-- NOTE: Original setup.sql uses PascalCase enum names ("BusinessType", "UserRole") with quotes —
-- this migration matches that convention.

-- ============================================================
-- 1. companies table
-- ============================================================
CREATE TABLE IF NOT EXISTS "companies" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "tax_id"      TEXT,
  "address"     TEXT,
  "phone"       TEXT,
  "logo_url"    TEXT,
  "brand_color" TEXT,
  "settings"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "companies_org_code_unique" UNIQUE ("org_id", "code")
);

CREATE INDEX IF NOT EXISTS "idx_companies_org_active" ON "companies"("org_id", "is_active");

-- Seed 2 companies for Pooilgroup
INSERT INTO "companies" ("id", "org_id", "code", "name", "is_active")
VALUES
  ('00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000001',
   'POOIL', 'Pooil Oil', true),
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000001',
   'JPSYNC', 'JP Sync Group', true)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updated_at" = now();

-- RLS for companies (only enable if current_org_id() function exists from prior migration)
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "companies_org_isolation" ON "companies";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id') THEN
    EXECUTE 'CREATE POLICY "companies_org_isolation" ON "companies" USING (org_id = current_org_id())';
  ELSE
    -- Fallback: allow all (will tighten in next migration when current_org_id() exists)
    EXECUTE 'CREATE POLICY "companies_allow_all" ON "companies" USING (true)';
  END IF;
END$$;

-- ============================================================
-- 2. New BusinessType enum values
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'lpg_retail'
                   AND enumtypid = '"BusinessType"'::regtype) THEN
    ALTER TYPE "BusinessType" ADD VALUE 'lpg_retail';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'cafe_punthai'
                   AND enumtypid = '"BusinessType"'::regtype) THEN
    ALTER TYPE "BusinessType" ADD VALUE 'cafe_punthai';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'massage_chair'
                   AND enumtypid = '"BusinessType"'::regtype) THEN
    ALTER TYPE "BusinessType" ADD VALUE 'massage_chair';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'claw_machine'
                   AND enumtypid = '"BusinessType"'::regtype) THEN
    ALTER TYPE "BusinessType" ADD VALUE 'claw_machine';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'training_center'
                   AND enumtypid = '"BusinessType"'::regtype) THEN
    ALTER TYPE "BusinessType" ADD VALUE 'training_center';
  END IF;
END$$;

-- ============================================================
-- 3. New UserRole enum values
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'admin'
                   AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'admin';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'area_manager'
                   AND enumtypid = '"UserRole"'::regtype) THEN
    ALTER TYPE "UserRole" ADD VALUE 'area_manager';
  END IF;
END$$;

-- ============================================================
-- 4. branches.company_id + branches.parent_branch_id
-- ============================================================
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "company_id" UUID REFERENCES "companies"("id") ON DELETE RESTRICT;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "parent_branch_id" UUID REFERENCES "branches"("id") ON DELETE SET NULL;

-- Backfill existing branches → Pooil Oil
UPDATE "branches"
SET "company_id" = '00000000-0000-0000-0000-0000000000a1'
WHERE "company_id" IS NULL
  AND "org_id" = '00000000-0000-0000-0000-000000000001';

-- Now enforce NOT NULL (only if all rows have it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "branches" WHERE "company_id" IS NULL) THEN
    BEGIN
      ALTER TABLE "branches" ALTER COLUMN "company_id" SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      -- Already NOT NULL or other; ignore
      NULL;
    END;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "idx_branches_company_active" ON "branches"("company_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_branches_parent" ON "branches"("parent_branch_id");

-- ============================================================
-- 5. branch_rentals + RentalType enum
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RentalType') THEN
    CREATE TYPE "RentalType" AS ENUM ('fixed_monthly', 'percentage', 'mixed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "branch_rentals" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "host_branch_id"   UUID NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "tenant_branch_id" UUID REFERENCES "branches"("id") ON DELETE SET NULL,
  "tenant_name"      TEXT NOT NULL,
  "rental_type"      "RentalType" NOT NULL,
  "fixed_amount"     NUMERIC(15, 2),
  "percentage_rate"  NUMERIC(6, 4),
  "start_date"       DATE NOT NULL,
  "end_date"         DATE,
  "notes"            TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_rentals_org_active" ON "branch_rentals"("org_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_rentals_host_active" ON "branch_rentals"("host_branch_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_rentals_tenant" ON "branch_rentals"("tenant_branch_id");

ALTER TABLE "branch_rentals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "branch_rentals_org_isolation" ON "branch_rentals";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id') THEN
    EXECUTE 'CREATE POLICY "branch_rentals_org_isolation" ON "branch_rentals" USING (org_id = current_org_id())';
  ELSE
    EXECUTE 'CREATE POLICY "branch_rentals_allow_all" ON "branch_rentals" USING (true)';
  END IF;
END$$;

-- ============================================================
-- 6. users.employee_code (Humansoft HR reference)
-- ============================================================
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "employee_code" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_org_employee_code_unique'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_org_employee_code_unique" UNIQUE ("org_id", "employee_code");
  END IF;
END$$;

-- ============================================================
-- 7. daily_reports.rental_income + daily_reports.training_sessions
-- ============================================================
ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "rental_income" NUMERIC(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "training_sessions" INTEGER;

-- ============================================================
-- Done
-- ============================================================
COMMENT ON TABLE "companies" IS 'Legal entities under one organization (Pooil Oil + JP Sync Group)';
COMMENT ON TABLE "branch_rentals" IS 'Sub-tenant rental contracts: ปั๊ม (host) ↔ ร้านค้าเช่า (tenant)';
COMMENT ON COLUMN "daily_reports"."rental_income" IS 'ค่าเช่าจากร้านค้าในพื้นที่ (สำหรับ host เช่นปั๊มน้ำมัน)';
COMMENT ON COLUMN "daily_reports"."training_sessions" IS 'จำนวนครั้งที่จัดอบรม (เฉพาะ training_center)';
