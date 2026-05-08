-- Pooilgroup ERP — Migration: audit_logs partial index for renewal chain
-- Date: 2026-05-08
--
-- Renewal-chain traversal in lib/docuflow/renewal-history.ts queries
-- audit_logs by `diff->'new'->>'oldDocumentId'` (a JSON path) which is
-- unindexed by default → sequential scan over all audit_logs rows.
--
-- This partial index limits to DOCUFLOW_RENEW + document resourceType so
-- the index stays small (only renewal events, ~100s of rows max even at
-- scale) and queries become O(log n) instead of O(n).
--
-- Idempotent.

CREATE INDEX IF NOT EXISTS "audit_logs_renew_old_doc_idx"
  ON "audit_logs" ((diff->'new'->>'oldDocumentId'))
  WHERE action = 'DOCUFLOW_RENEW' AND resource_type = 'document';

-- Also index the resource_id lookup direction (predecessor walk)
CREATE INDEX IF NOT EXISTS "audit_logs_renew_resource_idx"
  ON "audit_logs" (org_id, resource_id)
  WHERE action = 'DOCUFLOW_RENEW' AND resource_type = 'document';
