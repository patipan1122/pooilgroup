-- Inbox bot flow images — adds a JSONB column that lets the CEO attach an
-- image to each bot reply template (money_lost, scan_fail, strong, buy,
-- feedback, intro).  Keys are topic strings → R2 public URLs.
--
-- Empty default ({}) keeps existing rows valid without backfill.
--
-- Safe to re-run (IF NOT EXISTS).
ALTER TABLE public.inbox_bot_settings
  ADD COLUMN IF NOT EXISTS flow_images JSONB DEFAULT '{}'::jsonb NOT NULL;
