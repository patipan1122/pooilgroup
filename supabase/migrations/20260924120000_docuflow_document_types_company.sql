-- Pooilgroup ERP — Migration: DocuFlow Document Types — add company scoping
-- Date: 2026-09-24
--
-- CEO feedback 2026-09-24: when creating a document type from the new
-- upload-form quick-create shortcut, wants to optionally scope it to one
-- of the real legal entities (companies table — "Pooil Oil" / "JP Sync
-- Group"), in addition to the existing business_type grouping.
--
-- Additive, nullable — document_types currently has 0 rows in prod, and
-- existing behavior (NULL = applies org-wide) is unchanged.
--
-- RLS: document_types already has RLS enabled with org-scoped policies from
-- 20260923130000_docuflow_document_types.sql — this migration only adds a
-- column, so no new policy is needed.
--
-- Idempotent — safe to re-run.

ALTER TABLE "document_types"
  ADD COLUMN IF NOT EXISTS "company_id" UUID REFERENCES "companies"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "document_types_org_company_idx"
  ON "document_types" ("org_id", "company_id");
