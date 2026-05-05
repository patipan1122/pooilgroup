-- Pooilgroup ERP — Migration: Companies + Sub-tenant rentals + 4 new business types
-- Date: 2026-05-05
--
-- Adds:
--   1. companies table (Pooil Oil + JP Sync legal entities under one org)
--   2. branches.company_id + branches.parent_branch_id (sub-tenant model)
--   3. branch_rentals table (rental contracts: fixed / percentage / mixed)
--   4. New business_type values: lpg_retail, cafe_punthai, massage_chair, claw_machine, training_center
--   5. New user_role values: admin, area_manager
--   6. users.employee_code (Humansoft HR reference)
--   7. daily_reports.rental_income + daily_reports.training_sessions
--
-- Run AFTER setup.sql + 20260504000001_rls_and_jwt_claim.sql have been applied.
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. companies table
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code         text NOT NULL,
  name         text NOT NULL,
  tax_id       text,
  address      text,
  phone        text,
  logo_url     text,
  brand_color  text,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_org_code_unique UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_companies_org_active ON companies(org_id, is_active);

-- Seed 2 companies for Pooilgroup
INSERT INTO companies (id, org_id, code, name, is_active)
VALUES
  ('00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000001',
   'POOIL', 'Pooil Oil', true),
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000001',
   'JPSYNC', 'JP Sync Group', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = now();

-- RLS for companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "companies_org_isolation" ON companies;
CREATE POLICY "companies_org_isolation" ON companies
  USING (org_id = current_org_id());

-- ============================================================
-- 2. New business_type enum values
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'lpg_retail'
                   AND enumtypid = 'business_type'::regtype) THEN
    ALTER TYPE business_type ADD VALUE 'lpg_retail';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'cafe_punthai'
                   AND enumtypid = 'business_type'::regtype) THEN
    ALTER TYPE business_type ADD VALUE 'cafe_punthai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'massage_chair'
                   AND enumtypid = 'business_type'::regtype) THEN
    ALTER TYPE business_type ADD VALUE 'massage_chair';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'claw_machine'
                   AND enumtypid = 'business_type'::regtype) THEN
    ALTER TYPE business_type ADD VALUE 'claw_machine';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'training_center'
                   AND enumtypid = 'business_type'::regtype) THEN
    ALTER TYPE business_type ADD VALUE 'training_center';
  END IF;
END$$;

-- ============================================================
-- 3. New user_role enum values
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'admin'
                   AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                 WHERE enumlabel = 'area_manager'
                   AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'area_manager';
  END IF;
END$$;

-- ============================================================
-- 4. branches.company_id + branches.parent_branch_id
-- ============================================================
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parent_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

-- Backfill existing branches → Pooil Oil
UPDATE branches
SET company_id = '00000000-0000-0000-0000-0000000000a1'
WHERE company_id IS NULL
  AND org_id = '00000000-0000-0000-0000-000000000001';

-- Now make NOT NULL (defensive — only if any rows still missing it, will fail)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM branches WHERE company_id IS NULL) THEN
    BEGIN
      ALTER TABLE branches ALTER COLUMN company_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      -- Column may already be NOT NULL; ignore
      NULL;
    END;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_branches_company_active ON branches(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_branch_id);

-- ============================================================
-- 5. branch_rentals + rental_type enum
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_type') THEN
    CREATE TYPE rental_type AS ENUM ('fixed_monthly', 'percentage', 'mixed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS branch_rentals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  host_branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  tenant_branch_id  uuid REFERENCES branches(id) ON DELETE SET NULL,
  tenant_name       text NOT NULL,
  rental_type       rental_type NOT NULL,
  fixed_amount      numeric(15, 2),
  percentage_rate   numeric(6, 4),  -- 0.05 = 5%
  start_date        date NOT NULL,
  end_date          date,
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rentals_org_active ON branch_rentals(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rentals_host_active ON branch_rentals(host_branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rentals_tenant ON branch_rentals(tenant_branch_id);

ALTER TABLE branch_rentals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "branch_rentals_org_isolation" ON branch_rentals;
CREATE POLICY "branch_rentals_org_isolation" ON branch_rentals
  USING (org_id = current_org_id());

-- ============================================================
-- 6. users.employee_code (Humansoft HR reference)
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_org_employee_code_unique'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_org_employee_code_unique UNIQUE (org_id, employee_code);
  END IF;
END$$;

-- ============================================================
-- 7. daily_reports.rental_income + daily_reports.training_sessions
-- ============================================================
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS rental_income numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS training_sessions integer;

-- ============================================================
-- Done
-- ============================================================
COMMENT ON TABLE companies IS 'Legal entities under one organization (Pooil Oil + JP Sync Group)';
COMMENT ON TABLE branch_rentals IS 'Sub-tenant rental contracts: ปั๊ม (host) ↔ ร้านค้าเช่า (tenant) — fixed / percentage / mixed';
COMMENT ON COLUMN daily_reports.rental_income IS 'ค่าเช่าจากร้านค้าในพื้นที่ (สำหรับ host เช่นปั๊มน้ำมัน)';
COMMENT ON COLUMN daily_reports.training_sessions IS 'จำนวนครั้งที่จัดอบรม (เฉพาะ training_center)';
