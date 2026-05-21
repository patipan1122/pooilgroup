-- audit_logs WORM enforcement (Accountant audit 2026-05-20)
-- พ.ร.บ.บัญชี 2543 §14 + RULE H from CLAUDE.md: audit log must be append-only.
-- RLS policies are bypassed by service role (used in lib/audit/log.ts).
-- This TRIGGER blocks UPDATE/DELETE at DB level — survives even service_role calls.
--
-- Exception: super_admin can mark a row as legally redacted (e.g. court order)
-- by inserting a NEW row referencing the original — NEVER modifying in place.

BEGIN;

CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable (WORM) — UPDATE/DELETE not allowed. Append a new row to record reversal/redaction.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

COMMENT ON FUNCTION audit_logs_block_mutation() IS
  'WORM enforcement — audit_logs is append-only by Thai law (พ.ร.บ.บัญชี 2543 §14, 5+ year retention). Survives service_role bypass.';

COMMIT;
