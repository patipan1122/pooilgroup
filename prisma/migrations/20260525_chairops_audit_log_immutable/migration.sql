-- Wave-0 fix · Audit log immutability (DB-level guard)
--
-- Prevents UPDATE/DELETE on chairops."ChairopsAuditLog" regardless of caller
-- (admin client, raw SQL, RLS bypass, etc). Trigger raises an exception so
-- the offending tx aborts. INSERT is still allowed (that's how new audit
-- rows are written by app code).
--
-- Audit ref: /tmp/audit_chairops_phase1_aud.json (Phase-1 auditor recommendation)
-- Table name verified from prisma/migrations/9999_chairops_bootstrap_ALL.sql:
--   CREATE TABLE "chairops"."ChairopsAuditLog" (...)

CREATE OR REPLACE FUNCTION chairops.audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'chairops."ChairopsAuditLog" is append-only — UPDATE/DELETE/TRUNCATE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chairops_audit_log_immutable_update ON chairops."ChairopsAuditLog";
CREATE TRIGGER chairops_audit_log_immutable_update
  BEFORE UPDATE ON chairops."ChairopsAuditLog"
  FOR EACH ROW EXECUTE FUNCTION chairops.audit_log_immutable();

DROP TRIGGER IF EXISTS chairops_audit_log_immutable_delete ON chairops."ChairopsAuditLog";
CREATE TRIGGER chairops_audit_log_immutable_delete
  BEFORE DELETE ON chairops."ChairopsAuditLog"
  FOR EACH ROW EXECUTE FUNCTION chairops.audit_log_immutable();

-- TRUNCATE fires a different trigger event; covered separately at statement level.
DROP TRIGGER IF EXISTS chairops_audit_log_immutable_truncate ON chairops."ChairopsAuditLog";
CREATE TRIGGER chairops_audit_log_immutable_truncate
  BEFORE TRUNCATE ON chairops."ChairopsAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION chairops.audit_log_immutable();
