-- Pooilgroup ERP — Migration: DocuFlow Document Groups
-- Date: 2026-09-24
--
-- CEO feedback follow-up to the DocuFlow redesign — adds a SECOND, INDEPENDENT taxonomy
-- dimension alongside the existing `document_types` table. This is NOT the hardcoded
-- browse-page category tiles ("เอกสารนิติบุคคล/ภาษี/ประกัน") — it's a brand new, freely-defined
-- grouping concept an org can use for anything beyond "type". No canonical catalog, no
-- static fallback — just org-scoped CRUD, mirroring document_types' table shape minus the
-- type-specific columns (frequency/danger_level/regulator/canonical_key) that don't apply.
--
-- Also adds `documents.issue_date` — a document ISSUE date, separate from the existing
-- expiry-tracking date field.
--
-- CRITICAL: per the RLS incident 2026-09-22 (postmortems/supabase-rls-disabled-43-tables-2026-09-22.md,
-- 43 tables went live with RLS disabled because policies were deferred to a "later" migration
-- that never happened), the RLS policy for document_groups MUST ship in this SAME migration file
-- as the CREATE TABLE. Pattern matches supabase/migrations/20260923130000_docuflow_document_types.sql.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. document_groups — org-managed, freely-defined document grouping catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_groups" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_groups_org_name_unique" UNIQUE ("org_id", "name")
);

CREATE INDEX IF NOT EXISTS "document_groups_org_active_idx"
  ON "document_groups" ("org_id", "is_active");

-- ============================================================
-- RLS POLICIES — org-scoped access (ships in the SAME migration as CREATE TABLE, no deferral)
-- ============================================================
ALTER TABLE "document_groups" ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (used by adminClient + cron jobs)
DROP POLICY IF EXISTS "document_groups_service_role_all" ON "document_groups";
CREATE POLICY "document_groups_service_role_all" ON "document_groups"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users — org-scoped via JWT claim "org_id"
-- Pattern matches supabase/migrations/20260923130000_docuflow_document_types.sql
DROP POLICY IF EXISTS "document_groups_org_isolation" ON "document_groups";
CREATE POLICY "document_groups_org_isolation" ON "document_groups"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

-- ============================================================
-- 2. documents.document_group_id — new, additive, nullable FK
-- ============================================================
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "document_group_id" UUID REFERENCES "document_groups"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "documents_org_document_group_id_idx"
  ON "documents" ("org_id", "document_group_id");

-- ============================================================
-- 3. documents.issue_date — new, additive, nullable document issue date.
-- Separate from the existing expiry-tracking date column; no RLS needed here since
-- it's a plain column on the already-RLS-protected `documents` table.
-- ============================================================
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "issue_date" TIMESTAMPTZ(6);
