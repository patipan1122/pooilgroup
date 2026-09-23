-- Pooilgroup ERP — Migration: DocuFlow Google Drive Export Tracking
-- Date: 2026-09-23
--
-- DocuFlow redesign Track B, Item 11 (schema only) — adds tracking columns so a
-- `documents` row can record that it was exported to Google Drive via the opt-in,
-- per-document "Export to Drive" button (one-way, triggered by a person — see
-- docs/BIGFEATURE_docuflow-redesign_TRACKB_PLAN.md §0.5).
--
-- Additive only: all 4 columns are nullable. No existing column is touched.
--
-- No new RLS policy needed: `documents` already has a blanket per-row policy
-- (`documents_org_isolation`, FOR ALL, USING org_id = current_org_id() OR is_super_admin())
-- defined in supabase/migrations/20260508000007_rls_for_remaining_tables.sql — it is not
-- column-scoped, so it already covers these new columns. Confirmed by reading that policy
-- before writing this migration. Same pattern as the document_type_id column added in
-- supabase/migrations/20260923130000_docuflow_document_types.sql (also no new policy).
--
-- Idempotent — safe to re-run.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_file_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_exported_at TIMESTAMPTZ(6);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_exported_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
