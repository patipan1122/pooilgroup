-- Pooilgroup ERP — Migration: user_modules (per-user module access)
-- Date: 2026-05-07
--
-- Adds:
--   user_modules table — controls which modules each non-admin user can access.
--
-- Rationale:
--   When FuelOS / DocuFlow launch, the staff who use those modules should NOT
--   automatically see CashHub menus (and vice versa). The existing system gates
--   nav items by ROLE (e.g. "branch_manager") but has no way to express "user X
--   belongs to CashHub but not FuelOS".
--
-- Model:
--   Admin tier (super_admin / org_admin / admin) bypasses this table — they
--   always see every active module. For the rest, a row in user_modules with
--   is_active = true grants access to that module.
--
-- Backfill:
--   Existing non-admin users → cashhub row (current behaviour preserved).
--   FuelOS / DocuFlow rows are inserted by admins when those modules ship.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. user_modules table
-- ============================================================
CREATE TABLE IF NOT EXISTS "user_modules" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "module_name" TEXT NOT NULL,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "granted_by"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_modules_unique" UNIQUE ("org_id", "user_id", "module_name"),
  CONSTRAINT "user_modules_module_name_check"
    CHECK ("module_name" IN ('cashhub', 'fuelos', 'docuflow'))
);

CREATE INDEX IF NOT EXISTS "idx_user_modules_user_active"
  ON "user_modules"("user_id", "is_active");

CREATE INDEX IF NOT EXISTS "idx_user_modules_org_module"
  ON "user_modules"("org_id", "module_name", "is_active");

-- ============================================================
-- 2. RLS — same pattern as other org-scoped tables
-- ============================================================
ALTER TABLE "user_modules" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_modules_org_isolation" ON "user_modules";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org_id') THEN
    EXECUTE 'CREATE POLICY "user_modules_org_isolation" ON "user_modules"
             USING (org_id = current_org_id())';
  END IF;
END $$;

-- ============================================================
-- 3. Backfill — existing non-admin users get cashhub access
-- ============================================================
-- Insert one row per user (excluding admin tier — they bypass the check)
-- for the cashhub module. Skip rows that already exist.
INSERT INTO "user_modules" ("org_id", "user_id", "module_name", "is_active")
SELECT
  u."org_id",
  u."id",
  'cashhub',
  true
FROM "users" u
WHERE u."role" NOT IN ('super_admin', 'org_admin', 'admin')
  AND u."is_active" = true
ON CONFLICT ("org_id", "user_id", "module_name") DO NOTHING;
