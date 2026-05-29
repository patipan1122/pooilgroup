-- Inbox idempotency (audit P0-2) — prevent duplicate INBOUND messages from
-- LINE/FB provider retries (now more likely since the webhook returns 200 first
-- and processes async). Partial unique on (channel_id, external_id) for inbound
-- only; outbound + null-external rows are unaffected.
--
-- SAFE additive DDL. Apply via Supabase SQL editor.
-- If duplicates already exist they must be removed first (none in a fresh table).

CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_channel_external_in_uniq
  ON public.inbox_messages (channel_id, external_id)
  WHERE external_id IS NOT NULL AND direction = 'IN';
