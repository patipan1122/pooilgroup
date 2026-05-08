-- Pooilgroup ERP — Migration: DocuFlow Foundation
-- Date: 2026-05-08
--
-- Adds 8 tables for the DocuFlow document management module:
--   1. documents              — main file table (R2-backed)
--   2. document_ownership     — 4-level ownership (group/company/biz_type/branch/person)
--   3. document_tags          — cross-cutting tag system
--   4. document_renewals      — expiry tracking + renewal workflow
--   5. document_shared_branches — เอกสารใช้ร่วมกันหลายสาขา
--   6. vehicles               — fleet (~100 trucks · shared with FuelOS Phase 2)
--   7. vehicle_documents      — Document ↔ Vehicle link with doc_type + expiry
--   8. person_documents       — driver/staff personal docs (license/training/health)
--
-- Spec: ดีเทลv1/DOCUFLOW.md
--
-- Multi-tenant: every table org-scoped (org_id) with FK to organizations.
-- Soft delete: documents.is_active, vehicles.is_active.
-- Indexes optimised for org+status, expiry lookups, and entity joins.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. documents — main DocuFlow table
-- ============================================================
CREATE TABLE IF NOT EXISTS "documents" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "file_key"         TEXT NOT NULL,
  "file_public_url"  TEXT,
  "mime_type"        TEXT,
  "file_size"        INTEGER,
  "uploaded_by_id"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "is_active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "documents_org_active_idx"
  ON "documents" ("org_id", "is_active");
CREATE INDEX IF NOT EXISTS "documents_org_uploaded_idx"
  ON "documents" ("org_id", "uploaded_at" DESC);

-- ============================================================
-- 2. document_ownership — 4-level ownership
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_ownership" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id"    UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "level"          TEXT NOT NULL,
  "company_id"     UUID,
  "branch_id"      UUID,
  "person_id"      UUID,
  "business_type"  TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_ownership_level_check"
    CHECK (level IN ('group','company','business_type','branch','person'))
);

CREATE INDEX IF NOT EXISTS "document_ownership_org_level_idx"
  ON "document_ownership" ("org_id", "level");
CREATE INDEX IF NOT EXISTS "document_ownership_doc_idx"
  ON "document_ownership" ("document_id");
CREATE INDEX IF NOT EXISTS "document_ownership_branch_idx"
  ON "document_ownership" ("branch_id");

-- ============================================================
-- 3. document_tags
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_tags" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "tag"         TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_tags_unique" UNIQUE ("document_id", "tag")
);

CREATE INDEX IF NOT EXISTS "document_tags_org_tag_idx"
  ON "document_tags" ("org_id", "tag");

-- ============================================================
-- 4. document_renewals — expiry + renewal workflow
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_renewals" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id"            UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "expiry_date"            DATE NOT NULL,
  "renewal_period_years"   INTEGER,
  "alert_days"             INTEGER[] NOT NULL DEFAULT ARRAY[90, 30, 7],
  "responsible_user_id"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "status"                 TEXT NOT NULL DEFAULT 'pending',
  "last_renewed_date"      DATE,
  "next_renewal_date"      DATE,
  "notes"                  TEXT,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_renewals_status_check"
    CHECK (status IN ('pending','in_progress','renewed','overdue'))
);

CREATE INDEX IF NOT EXISTS "document_renewals_org_expiry_idx"
  ON "document_renewals" ("org_id", "expiry_date");
CREATE INDEX IF NOT EXISTS "document_renewals_org_status_idx"
  ON "document_renewals" ("org_id", "status");

-- ============================================================
-- 5. document_shared_branches — เอกสารใช้ร่วมกันหลายสาขา
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_shared_branches" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "branch_id"   UUID NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "added_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "document_shared_branches_unique" UNIQUE ("document_id", "branch_id")
);

CREATE INDEX IF NOT EXISTS "document_shared_branches_org_idx"
  ON "document_shared_branches" ("org_id");
CREATE INDEX IF NOT EXISTS "document_shared_branches_branch_idx"
  ON "document_shared_branches" ("branch_id");

-- ============================================================
-- 6. vehicles — fleet (~100 trucks)
-- ============================================================
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "license_plate"  TEXT NOT NULL,
  "vehicle_type"   TEXT NOT NULL,
  "company_id"     UUID REFERENCES "companies"("id") ON DELETE SET NULL,
  "branch_id"      UUID REFERENCES "branches"("id") ON DELETE SET NULL,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"          TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vehicles_org_plate_unique" UNIQUE ("org_id", "license_plate")
);

CREATE INDEX IF NOT EXISTS "vehicles_org_active_idx"
  ON "vehicles" ("org_id", "is_active");
CREATE INDEX IF NOT EXISTS "vehicles_branch_idx"
  ON "vehicles" ("branch_id");

-- ============================================================
-- 7. vehicle_documents — Document ↔ Vehicle link
-- ============================================================
CREATE TABLE IF NOT EXISTS "vehicle_documents" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "vehicle_id"   UUID NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "document_id"  UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "doc_type"     TEXT NOT NULL,
  "expiry_date"  DATE,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vehicle_documents_unique"
    UNIQUE ("vehicle_id", "doc_type", "document_id")
);

CREATE INDEX IF NOT EXISTS "vehicle_documents_org_expiry_idx"
  ON "vehicle_documents" ("org_id", "expiry_date");

-- ============================================================
-- 8. person_documents — driver/staff personal docs
-- ============================================================
CREATE TABLE IF NOT EXISTS "person_documents" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "document_id"  UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "doc_type"     TEXT NOT NULL,
  "expiry_date"  DATE,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "person_documents_unique"
    UNIQUE ("user_id", "doc_type", "document_id")
);

CREATE INDEX IF NOT EXISTS "person_documents_org_expiry_idx"
  ON "person_documents" ("org_id", "expiry_date");

-- ============================================================
-- RLS POLICIES — org-scoped access
-- ============================================================
ALTER TABLE "documents"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_ownership"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_tags"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_renewals"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_shared_branches"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_documents"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_documents"          ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (used by adminClient + cron jobs)
DROP POLICY IF EXISTS "documents_service_role_all" ON "documents";
CREATE POLICY "documents_service_role_all" ON "documents"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "document_ownership_service_role_all" ON "document_ownership";
CREATE POLICY "document_ownership_service_role_all" ON "document_ownership"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "document_tags_service_role_all" ON "document_tags";
CREATE POLICY "document_tags_service_role_all" ON "document_tags"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "document_renewals_service_role_all" ON "document_renewals";
CREATE POLICY "document_renewals_service_role_all" ON "document_renewals"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "document_shared_branches_service_role_all" ON "document_shared_branches";
CREATE POLICY "document_shared_branches_service_role_all" ON "document_shared_branches"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicles_service_role_all" ON "vehicles";
CREATE POLICY "vehicles_service_role_all" ON "vehicles"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicle_documents_service_role_all" ON "vehicle_documents";
CREATE POLICY "vehicle_documents_service_role_all" ON "vehicle_documents"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "person_documents_service_role_all" ON "person_documents";
CREATE POLICY "person_documents_service_role_all" ON "person_documents"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users — org-scoped via JWT claim "org_id"
-- Pattern matches existing tables (see 20260508000001_rls_for_remaining_tables.sql)
DROP POLICY IF EXISTS "documents_org_isolation" ON "documents";
CREATE POLICY "documents_org_isolation" ON "documents"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "document_ownership_org_isolation" ON "document_ownership";
CREATE POLICY "document_ownership_org_isolation" ON "document_ownership"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "document_tags_org_isolation" ON "document_tags";
CREATE POLICY "document_tags_org_isolation" ON "document_tags"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "document_renewals_org_isolation" ON "document_renewals";
CREATE POLICY "document_renewals_org_isolation" ON "document_renewals"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "document_shared_branches_org_isolation" ON "document_shared_branches";
CREATE POLICY "document_shared_branches_org_isolation" ON "document_shared_branches"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "vehicles_org_isolation" ON "vehicles";
CREATE POLICY "vehicles_org_isolation" ON "vehicles"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "vehicle_documents_org_isolation" ON "vehicle_documents";
CREATE POLICY "vehicle_documents_org_isolation" ON "vehicle_documents"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "person_documents_org_isolation" ON "person_documents";
CREATE POLICY "person_documents_org_isolation" ON "person_documents"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

-- ============================================================
-- audit_logs.action — extend allowed values for DocuFlow + vehicles
-- ============================================================
-- Most projects keep audit_logs.action as TEXT without a CHECK.
-- If a CHECK exists, it should be widened. The Prisma model uses a
-- TS-only union; the DB column is unconstrained TEXT — so no DDL needed
-- here. New audit values:
--   DOCUFLOW_UPLOAD, DOCUFLOW_RENEW, DOCUFLOW_TAG, DOCUFLOW_DELETE,
--   DOCUFLOW_SHARE, VEHICLE_CREATE, VEHICLE_UPDATE,
--   APPROVE_REGISTER_REQUEST, REJECT_REGISTER_REQUEST
