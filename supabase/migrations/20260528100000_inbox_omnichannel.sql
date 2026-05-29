-- Pooilgroup ERP — INBOX (unified omnichannel customer-message hub)
-- 2026-05-28 · 8 tables + 3 enums
--   inbox_channels, inbox_conversations, inbox_messages,
--   inbox_bot_faqs, inbox_bot_knowledge, inbox_bot_settings,
--   inbox_bot_unanswered, inbox_daily_summaries
--
-- One program that merges MULTIPLE LINE OAs + Facebook Pages into a single
-- inbox. AI auto-reply bot is gated per-channel (bot_enabled) — only ON for
-- ChairOps (massage-chair) channels for now.
--
-- SAFE TO APPLY: pure additive DDL (CREATE ... IF NOT EXISTS). Does NOT touch
-- any existing table. Apply via Supabase SQL editor or psql — do NOT use
-- `prisma db push` (avoids the known schema-drift drop warnings).
--
-- Enum type names are PascalCase-quoted to match what Prisma's generated
-- client expects (so a later `prisma db push` sees no drift).

-- ============================================================
-- Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public."InboxPlatform" AS ENUM ('LINE', 'FACEBOOK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."InboxDirection" AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."InboxConversationStatus" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1. inbox_channels — connected LINE OAs / FB Pages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_channels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  platform         public."InboxPlatform" NOT NULL,
  display_name     text NOT NULL,
  business_tag     text,
  external_id      text,
  access_token_enc text,
  webhook_secret   text,
  bot_enabled      boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'setup',
  last_event_at    timestamptz,
  metadata         jsonb,
  created_by_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_channels_org_platform_idx ON public.inbox_channels (org_id, platform);
CREATE INDEX IF NOT EXISTS inbox_channels_org_business_idx ON public.inbox_channels (org_id, business_tag);

-- ============================================================
-- 2. inbox_conversations — one thread per (channel, external user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  channel_id       uuid NOT NULL REFERENCES public.inbox_channels (id) ON DELETE CASCADE,
  platform         public."InboxPlatform" NOT NULL,
  external_user_id text NOT NULL,
  display_name     text,
  status           public."InboxConversationStatus" NOT NULL DEFAULT 'OPEN',
  topic_tag        text,
  is_lead          boolean NOT NULL DEFAULT false,
  is_urgent        boolean NOT NULL DEFAULT false,
  needs_human      boolean NOT NULL DEFAULT false,
  contact_phone    text,
  contact_note     text,
  assigned_to_id   uuid,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  last_inbound_at  timestamptz,
  unread_count     integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_conversations_channel_user_uniq UNIQUE (channel_id, external_user_id)
);
CREATE INDEX IF NOT EXISTS inbox_conversations_org_status_idx ON public.inbox_conversations (org_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS inbox_conversations_org_recent_idx ON public.inbox_conversations (org_id, last_message_at DESC);

-- ============================================================
-- 3. inbox_messages — every inbound + outbound message
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.inbox_conversations (id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES public.inbox_channels (id) ON DELETE CASCADE,
  platform        public."InboxPlatform" NOT NULL,
  direction       public."InboxDirection" NOT NULL,
  body            text NOT NULL,
  sent_by_bot     boolean NOT NULL DEFAULT false,
  external_id     text,
  attachments     jsonb,
  error_message   text,
  created_by_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_messages_conv_idx ON public.inbox_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS inbox_messages_org_recent_idx ON public.inbox_messages (org_id, created_at DESC);

-- ============================================================
-- 4. inbox_bot_faqs — deterministic FAQ (matched before AI, free)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_bot_faqs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  business_tag  text NOT NULL,
  intent        text,
  keywords      text NOT NULL,
  answer        text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  priority      integer NOT NULL DEFAULT 0,
  hits          integer NOT NULL DEFAULT 0,
  created_by_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_bot_faqs_lookup_idx ON public.inbox_bot_faqs (org_id, business_tag, enabled);

-- ============================================================
-- 5. inbox_bot_knowledge — free-text business facts (AI context)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_bot_knowledge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  business_tag  text NOT NULL,
  title         text NOT NULL,
  content       text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_by_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_bot_knowledge_lookup_idx ON public.inbox_bot_knowledge (org_id, business_tag, enabled);

-- ============================================================
-- 6. inbox_bot_settings — per-business bot config
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_bot_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  business_tag  text NOT NULL,
  bot_enabled   boolean NOT NULL DEFAULT true,
  tone          text NOT NULL DEFAULT 'สุภาพ สั้น เป็นกันเอง',
  bot_name      text,
  contact_phone text,
  fallback_text text NOT NULL DEFAULT 'ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ',
  escalate_text text,
  daily_summary boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_bot_settings_org_business_uniq UNIQUE (org_id, business_tag)
);

-- ============================================================
-- 7. inbox_bot_unanswered — training queue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_bot_unanswered (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  business_tag    text NOT NULL,
  conversation_id uuid,
  question        text NOT NULL,
  resolved        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_bot_unanswered_lookup_idx ON public.inbox_bot_unanswered (org_id, business_tag, resolved);

-- ============================================================
-- 8. inbox_daily_summaries — cached daily summary (1 AI call/day)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inbox_daily_summaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  business_tag text NOT NULL,
  summary_date date NOT NULL,
  stats        jsonb NOT NULL,
  ai_text      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_daily_summaries_uniq UNIQUE (org_id, business_tag, summary_date)
);

-- ============================================================
-- RLS — org isolation (defense-in-depth; app uses service-role Prisma)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inbox_channels','inbox_conversations','inbox_messages',
    'inbox_bot_faqs','inbox_bot_knowledge','inbox_bot_settings',
    'inbox_bot_unanswered','inbox_daily_summaries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_org_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (org_id = public.current_org_id() OR public.is_super_admin()) WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());',
      t || '_org_isolation', t
    );
  END LOOP;
END $$;
