-- Pooilgroup ERP — Data cleanup: DocuFlow seed/test documents
-- Date: 2026-09-24
--
-- All 41 active `documents` rows in this org were created in a single burst
-- on 2026-05-23 (module bootstrap seed data) — names carry "(Test)" suffixes,
-- reference test branch code "JP-FUEL-001" and dummy accounts ("admin01").
-- Verified: zero real business documents exist in the org today.
--
-- CEO explicitly requested removal (2026-09-24, confirmed twice: initial
-- request + explicit re-confirmation after being told what would be deleted).
--
-- Soft-delete only (is_active = false) — matches the existing recoverable
-- delete convention already used by app/api/docuflow/[id]/route.ts's DELETE
-- handler (DOCUFLOW_DELETE audit action). Not a hard DELETE; every row is
-- still recoverable from the database if ever needed.

WITH deleted AS (
  UPDATE documents
  SET is_active = false, updated_at = now()
  WHERE is_active = true
  RETURNING id, org_id, name
)
-- Audit trail — same shape as the app's own audit() helper writes
-- (lib/audit/log.ts), so this bulk action shows up in DocuFlow's Audit Log
-- like any other delete would.
INSERT INTO audit_logs (id, org_id, user_id, action, resource_type, resource_id, diff, created_at)
SELECT
  gen_random_uuid(),
  d.org_id,
  NULL,
  'DOCUFLOW_DELETE',
  'Document',
  d.id,
  jsonb_build_object(
    'old', jsonb_build_object('isActive', true, 'name', d.name),
    'new', jsonb_build_object('isActive', false),
    'reason', 'bulk cleanup: CEO-requested removal of 2026-05-23 seed/test data, no real docs existed'
  ),
  now()
FROM deleted d;
