-- Pooilgroup ERP — Migration: DocuFlow Polish (advanced placement types)
-- Date: 2026-05-08
--
-- Adds placement_type discriminator to document_signature_placements so that
-- admins can place signature boxes, date stamps, name stamps, and free text
-- on a PDF (per DOCUFLOW.md spec §12 lines 507-512).
--
-- Idempotent — safe to re-run.

ALTER TABLE "document_signature_placements"
  ADD COLUMN IF NOT EXISTS "placement_type" TEXT NOT NULL DEFAULT 'signature',
  ADD COLUMN IF NOT EXISTS "auto_fill_value" TEXT;

ALTER TABLE "document_signature_placements"
  DROP CONSTRAINT IF EXISTS "dsp_placement_type_check";
ALTER TABLE "document_signature_placements"
  ADD CONSTRAINT "dsp_placement_type_check"
  CHECK (placement_type IN ('signature','date','name','text'));
