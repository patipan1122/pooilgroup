-- =============================================================
-- ChairOps · cache bound LINE profile on the user record (CEO 2026-06-18)
-- =============================================================
-- The Users admin page only knew the opaque LINE userId ("Uxxxx…"). The office
-- wants to see WHICH LINE account (the display name) is bound to each user.
-- These columns are filled at line-login bind time (and refreshed on each login).
-- Nullable + idempotent — safe to re-run, no backfill needed (existing maids
-- backfill the next time they open the LINE Mini App).
-- =============================================================

ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS "lineDisplayName" text,
  ADD COLUMN IF NOT EXISTS "linePictureUrl"  text;
