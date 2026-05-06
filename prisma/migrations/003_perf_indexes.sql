-- ============================================================
-- Pooilgroup ERP — Performance Indexes (composite)
-- Apply AFTER 002_core_extensions.sql. Idempotent — safe to re-run.
--
-- Reasoning:
--   - daily_reports queries always scope (org_id, status) + filter by report_date.
--     Existing single-column indexes force scan after first match.
--   - audit_logs page filters by org_id first, then action + date range.
--     Existing index on (action, created_at) skips the org filter.
--   - daily_reports detail pages filter by branch_id + shift together.
--
-- Uses CREATE INDEX CONCURRENTLY so no table lock during build.
-- Run in psql directly (not in a transaction) for CONCURRENTLY to work.
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_reports_org_status_date_idx
  ON daily_reports (org_id, status, report_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS daily_reports_branch_shift_date_idx
  ON daily_reports (branch_id, shift, report_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_org_action_date_idx
  ON audit_logs (org_id, action, created_at);
