-- Pooilgroup ERP · recruit module
--
-- 2026-05-26: /bigsolvebug run #1 caught 2 unique constraints missing
--   B-001 webhook idempotency · LINE/FB retry → duplicate messages
--   P1-15 blacklist dup · same person can be blacklisted twice concurrently
--
-- Both use PARTIAL unique indexes (Postgres) to allow NULL/removed rows.
-- Prisma can't represent partial unique · enforced at DB layer · app-level
-- defense added in lib/recruit/inbox-ingest.ts (findFirst-then-create).
--
-- Apply: pnpm prisma db execute --file=...
-- Verify: SELECT indexname FROM pg_indexes WHERE tablename IN (...);

-- ============================================================
-- 1. recruit_messages · idempotent webhook ingest
-- ============================================================
-- Applies only when both columns are non-null (provider-supplied event IDs).
-- INAPP/EMAIL legacy rows have NULL channel_instance_id · not affected.

DROP INDEX IF EXISTS public.recruit_messages_webhook_idempotency;
CREATE UNIQUE INDEX recruit_messages_webhook_idempotency
  ON public.recruit_messages (channel_instance_id, external_id)
  WHERE channel_instance_id IS NOT NULL AND external_id IS NOT NULL;

-- ============================================================
-- 2. recruit_blacklist · active entry per (org, phone)
-- ============================================================
-- Applies only to active (not removed) entries with a phone number.
-- Allows re-adding after removal · allows phone=NULL (name-only blacklist).

DROP INDEX IF EXISTS public.recruit_blacklist_active_phone_uniq;
CREATE UNIQUE INDEX recruit_blacklist_active_phone_uniq
  ON public.recruit_blacklist (org_id, phone)
  WHERE phone IS NOT NULL AND removed_at IS NULL;

-- ============================================================
-- 3. Verification (run after apply · should return both indexes)
-- ============================================================
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public'
--     AND indexname IN ('recruit_messages_webhook_idempotency',
--                       'recruit_blacklist_active_phone_uniq');
