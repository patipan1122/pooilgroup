-- Pooilgroup ERP — Migration: DocuFlow Document Types
-- Date: 2026-09-23
--
-- DocuFlow redesign Track A, Item 3 — adds a real, org-managed `document_types` table.
-- Today "document type" is just a hardcoded static array in lib/docuflow/canonical-docs.ts
-- with no DB backing and no way for an admin to create/manage custom types.
--
-- Additive only: `documents.document_type` (free-text string) is NOT touched or removed —
-- it stays exactly as-is for backward compatibility. The new `document_type_id` FK is a
-- separate, nullable, additive column.
--
-- CRITICAL: per the RLS incident 2026-09-22 (postmortems/supabase-rls-disabled-43-tables-2026-09-22.md,
-- 43 tables went live with RLS disabled because policies were deferred to a "later" migration
-- that never happened), the RLS policy for document_types MUST ship in this SAME migration file
-- as the CREATE TABLE. Pattern matches supabase/migrations/20260508000002_docuflow_foundation.sql.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. document_types — org-managed document type catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_types" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"           TEXT NOT NULL,
  "category"       TEXT,
  "business_type"  TEXT,
  "frequency"      TEXT,
  "danger_level"   TEXT,
  "regulator"      TEXT,
  "description"    TEXT,
  "canonical_key"  TEXT,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_types_org_name_unique" UNIQUE ("org_id", "name")
);

CREATE INDEX IF NOT EXISTS "document_types_org_active_idx"
  ON "document_types" ("org_id", "is_active");

-- ============================================================
-- RLS POLICIES — org-scoped access (ships in the SAME migration as CREATE TABLE, no deferral)
-- ============================================================
ALTER TABLE "document_types" ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (used by adminClient + cron jobs)
DROP POLICY IF EXISTS "document_types_service_role_all" ON "document_types";
CREATE POLICY "document_types_service_role_all" ON "document_types"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users — org-scoped via JWT claim "org_id"
-- Pattern matches supabase/migrations/20260508000002_docuflow_foundation.sql
DROP POLICY IF EXISTS "document_types_org_isolation" ON "document_types";
CREATE POLICY "document_types_org_isolation" ON "document_types"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

-- ============================================================
-- 2. documents.document_type_id — new, additive, nullable FK
-- The existing documents.document_type free-text column is untouched.
-- ============================================================
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "document_type_id" UUID REFERENCES "document_types"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "documents_org_document_type_id_idx"
  ON "documents" ("org_id", "document_type_id");
