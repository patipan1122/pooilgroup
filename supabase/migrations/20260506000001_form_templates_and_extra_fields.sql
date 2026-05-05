-- Pooilgroup ERP — Migration: Form Templates (Free mode) + extra_fields on daily_reports
-- Date: 2026-05-06
--
-- Adds:
--   1. form_templates table — multiple custom variants per business type per org
--   2. branches.form_template_id — each branch picks which variant to use
--   3. daily_reports.extra_fields — JSONB sidecar for custom field values
--
-- Why: Admin (super_admin/org_admin) can create custom form variants per business type
-- (e.g., "ปั๊มน้ำมัน v1 (default)", "ปั๊มน้ำมัน v2 มีคาร์แคร์") with the ability to ADD
-- new fields beyond the built-in spec. Future payment channels (e.g., new e-wallets)
-- can be added without DB schema migration.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. form_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS "form_templates" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "business_type" TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1,
  "is_default"    BOOLEAN NOT NULL DEFAULT false,
  -- overrides on built-in fields: { fieldKey: { label?, hint?, placeholder?, required?, hidden?, numericOnly? } }
  "overrides"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- custom fields added by admin: [{ key, label, type, group, required, hint, placeholder, unit, numericOnly, isPaymentChannel, sortOrder }]
  "custom_fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_by"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "form_templates_org_type_version_unique"
    UNIQUE ("org_id", "business_type", "version")
);

CREATE INDEX IF NOT EXISTS "idx_form_templates_org_type_active"
  ON "form_templates" ("org_id", "business_type", "is_active");

-- Only ONE default per (org, business_type)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_form_templates_one_default_per_type"
  ON "form_templates" ("org_id", "business_type")
  WHERE "is_default" = true AND "is_active" = true;

-- ============================================================
-- 2. branches.form_template_id
-- ============================================================
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "form_template_id" UUID
    REFERENCES "form_templates"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_branches_form_template"
  ON "branches" ("form_template_id")
  WHERE "form_template_id" IS NOT NULL;

-- ============================================================
-- 3. daily_reports.extra_fields
-- ============================================================
ALTER TABLE "daily_reports"
  ADD COLUMN IF NOT EXISTS "extra_fields" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 4. RLS — read: same org · write: super_admin/org_admin only
-- ============================================================
ALTER TABLE "form_templates" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_templates_select_same_org" ON "form_templates";
CREATE POLICY "form_templates_select_same_org" ON "form_templates"
  FOR SELECT
  USING ("org_id" = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid);

DROP POLICY IF EXISTS "form_templates_admin_write" ON "form_templates";
CREATE POLICY "form_templates_admin_write" ON "form_templates"
  FOR ALL
  USING (
    "org_id" = (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('super_admin', 'org_admin', 'admin')
  );

-- ============================================================
-- 5. updated_at trigger (define helper if missing)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "form_templates_set_updated_at" ON "form_templates";
CREATE TRIGGER "form_templates_set_updated_at"
  BEFORE UPDATE ON "form_templates"
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- DONE
-- ============================================================
COMMENT ON TABLE "form_templates" IS
  'Custom form variants per business type. v1 = default (admin can override), v2+ = custom variants. Each branch picks which template via branches.form_template_id.';
COMMENT ON COLUMN "daily_reports"."extra_fields" IS
  'JSONB map of custom field values (key from form_templates.custom_fields[].key). Built-in fields stay in their dedicated columns.';
