-- Pooilgroup ERP — Migration: DocuFlow Saved Signature
-- Date: 2026-09-23
--
-- DocuFlow redesign Track B, Item 12 — lets a user save one signature image and
-- reuse it across multiple document-signing events, instead of drawing fresh
-- every time. Additive, nullable columns on the existing `users` table.
--
-- No new table, no new RLS policy: `users` already has RLS enabled with a
-- row-level (not column-scoped) policy set — `users_same_org_read` (same-org
-- SELECT) and `users_self_update` (UPDATE where id = auth.uid(), no column
-- restriction) — see supabase/migrations/20260504000001_rls_and_jwt_claim.sql.
-- These 2 new columns are automatically covered by that existing policy.
--
-- Idempotent — safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_signature_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_signature_updated_at TIMESTAMPTZ(6);
