-- Performance indexes from ultraview audit (รอบ 46 · 2026-05-21)
-- Each index supports a hot query path identified in the audit:
--   1. Recruit inbox: filter by org × draft × status, sorted by submittedAt DESC
--   2. Notifications: per-org unread firehose for admin counts
--   3. Module switcher: per-org active module lookup
--
-- All three use IF NOT EXISTS so re-running is safe. No table locks of note —
-- these are CREATE INDEX (not CONCURRENTLY) because tables are still small;
-- swap to CONCURRENTLY if row counts grow > 1M before this lands in prod.

CREATE INDEX IF NOT EXISTS recruit_applications_org_draft_status_submitted_idx
  ON public.recruit_applications (org_id, draft, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS notifications_org_is_read_created_idx
  ON public.notifications (org_id, is_read, created_at);

CREATE INDEX IF NOT EXISTS org_modules_org_is_active_idx
  ON public.org_modules (org_id, is_active);
