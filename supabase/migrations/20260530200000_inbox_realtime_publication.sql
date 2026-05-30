-- Enable Supabase Realtime broadcast on the `inbox:org:<orgId>` topic.
-- We use broadcast (NOT postgres_changes) so the channel doesn't require RLS
-- on the inbox tables for the anon-key browser client — the server-side
-- broadcastInboxChange() in lib/inbox/realtime-server.ts sends events
-- explicitly via service-role.
--
-- No DDL needed for broadcast — this file exists as a marker so the
-- realtime-feature deploy line stays auditable + searchable, and as a
-- hook-point if we later add postgres_changes-style subscriptions that DO
-- need a publication entry.
--
-- Safe to re-run (no-op DO block).

DO $$
BEGIN
  -- Reserved for future postgres_changes additions, e.g.:
  --   ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_messages;
  --   ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_conversations;
  -- Broadcast mode (current implementation) doesn't need these.
  RAISE NOTICE 'inbox realtime uses broadcast — no publication changes required';
END $$;
