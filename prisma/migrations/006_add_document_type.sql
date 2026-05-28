-- 006 — Add documents.document_type column
-- Phase 2 of DocuFlow redesign 2026-05-10:
--   Smart-upload wizard sets this to canonical doc name from canonical-docs.ts
--   (e.g. "ใบอนุญาตสถานีบริการน้ำมัน"). Existing rows stay NULL — back-fill is
--   optional via /docuflow/documents/[id] edit when admins revisit old docs.
--
-- Non-breaking: nullable, no default, no FK constraint. Pure metadata add.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "document_type" TEXT;

CREATE INDEX IF NOT EXISTS "documents_org_id_document_type_idx"
  ON "documents" ("org_id", "document_type");
