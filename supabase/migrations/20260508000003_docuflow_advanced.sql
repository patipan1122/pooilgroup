-- Pooilgroup ERP — Migration: DocuFlow Advanced (capabilities H, I, G)
-- Date: 2026-05-08
--
-- Adds 3 tables for DocuFlow advanced capabilities:
--   30. document_signature_placements — capability I (Signature Placement)
--   31. document_analyses             — capability H (AI Risk Analysis cache)
--   32. ai_search_cache               — capability G (AI Search query cache)
--
-- Spec: ดีเทลv1/DOCUFLOW.md sections 7, 12, 13
-- Idempotent — safe to re-run.

-- ============================================================
-- 30. document_signature_placements
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_signature_placements" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id"       UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "page_number"       INTEGER NOT NULL,
  "x_ratio"           DOUBLE PRECISION NOT NULL,
  "y_ratio"           DOUBLE PRECISION NOT NULL,
  "width_ratio"       DOUBLE PRECISION NOT NULL,
  "height_ratio"      DOUBLE PRECISION NOT NULL,
  "signer_role"       TEXT NOT NULL,
  "signer_user_id"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "signer_name"       TEXT,
  "label"             TEXT,
  "ordering"          INTEGER NOT NULL DEFAULT 0,
  "signed_at"         TIMESTAMPTZ(6),
  "signed_image_key"  TEXT,
  "signed_file_key"   TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "dsp_signer_role_check"
    CHECK (signer_role IN ('owner','employee','counterparty','other'))
);

CREATE INDEX IF NOT EXISTS "dsp_org_doc_idx"
  ON "document_signature_placements" ("org_id", "document_id");
CREATE INDEX IF NOT EXISTS "dsp_signer_idx"
  ON "document_signature_placements" ("signer_user_id");

-- ============================================================
-- 31. document_analyses
-- ============================================================
CREATE TABLE IF NOT EXISTS "document_analyses" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "document_id"      UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "file_key"         TEXT NOT NULL,
  "analysis_type"    TEXT NOT NULL,
  "risk_level"       TEXT,
  "summary_text"     TEXT,
  "watch_out_points" JSONB,
  "normal_points"    JSONB,
  "metadata_json"    JSONB,
  "model_used"       TEXT,
  "tokens_used"      INTEGER,
  "analyzed_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "da_unique_doc_filekey_type"
    UNIQUE ("document_id", "file_key", "analysis_type"),
  CONSTRAINT "da_risk_level_check"
    CHECK (risk_level IS NULL OR risk_level IN ('green','yellow','red')),
  CONSTRAINT "da_analysis_type_check"
    CHECK (analysis_type IN ('risk','summary','metadata'))
);

CREATE INDEX IF NOT EXISTS "da_org_idx"
  ON "document_analyses" ("org_id");

-- ============================================================
-- 32. ai_search_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS "ai_search_cache" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "query_hash"  TEXT NOT NULL,
  "query"       TEXT NOT NULL,
  "result_json" JSONB NOT NULL,
  "hit_count"   INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "asc_unique_org_hash" UNIQUE ("org_id", "query_hash")
);

CREATE INDEX IF NOT EXISTS "asc_org_expires_idx"
  ON "ai_search_cache" ("org_id", "expires_at");

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE "document_signature_placements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_analyses"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_search_cache"               ENABLE ROW LEVEL SECURITY;

-- service_role bypass
DROP POLICY IF EXISTS "dsp_service_role_all" ON "document_signature_placements";
CREATE POLICY "dsp_service_role_all" ON "document_signature_placements"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "da_service_role_all" ON "document_analyses";
CREATE POLICY "da_service_role_all" ON "document_analyses"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "asc_service_role_all" ON "ai_search_cache";
CREATE POLICY "asc_service_role_all" ON "ai_search_cache"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated org isolation
DROP POLICY IF EXISTS "dsp_org_isolation" ON "document_signature_placements";
CREATE POLICY "dsp_org_isolation" ON "document_signature_placements"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "da_org_isolation" ON "document_analyses";
CREATE POLICY "da_org_isolation" ON "document_analyses"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

DROP POLICY IF EXISTS "asc_org_isolation" ON "ai_search_cache";
CREATE POLICY "asc_org_isolation" ON "ai_search_cache"
  FOR ALL TO authenticated
  USING (org_id::text = COALESCE(auth.jwt()->>'org_id', ''))
  WITH CHECK (org_id::text = COALESCE(auth.jwt()->>'org_id', ''));

-- ============================================================
-- Notes on AuditAction additions:
--   New audit values used by capabilities G/H/I:
--     DOCUFLOW_SIGN_PLACEMENT_ADD
--     DOCUFLOW_SIGN_PLACEMENT_DELETE
--     DOCUFLOW_SIGNATURE_SIGNED
--     DOCUFLOW_ANALYZE
--     DOCUFLOW_SEARCH
--   The audit_logs.action column is unconstrained TEXT, so no DDL needed.
-- ============================================================
