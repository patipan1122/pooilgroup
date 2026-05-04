-- ============================================================
-- Pooilgroup ERP — Core System Extensions (9 tables)
-- Apply AFTER setup.sql. Idempotent — safe to re-run.
--
-- Adds:
--   notifications          — in-app notification inbox
--   user_sessions          — login/device tracking
--   register_requests      — self-register queue
--   org_modules            — module toggle per org
--   branch_groups          — cluster branches
--   branch_group_members   — N:M
--   holidays               — per-org calendar
--   telegram_subscriptions — user ↔ bot pairing
--   telegram_groups        — group routing
--   telegram_pairing_tokens — /start <token> flow
--
-- Plus RLS policies for each new table (org-scoped).
-- ============================================================

-- ============================================================
-- 1. notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"            UUID NOT NULL,
  "org_id"        UUID NOT NULL,
  "user_id"       UUID NOT NULL,
  "type"          TEXT NOT NULL,
  "module"        TEXT,
  "title"         TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "link"          TEXT,
  "is_read"       BOOLEAN NOT NULL DEFAULT false,
  "sent_telegram" BOOLEAN NOT NULL DEFAULT false,
  "sent_line"     BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_created_at_idx"
  ON "notifications" ("user_id", "is_read", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_org_id_created_at_idx"
  ON "notifications" ("org_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. user_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id"             UUID NOT NULL,
  "org_id"         UUID NOT NULL,
  "user_id"        UUID NOT NULL,
  "ip_address"     INET,
  "user_agent"     TEXT,
  "device"         TEXT,
  "login_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "logout_at"      TIMESTAMPTZ(6),
  "is_revoked"     BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_login_at_idx"
  ON "user_sessions" ("user_id", "login_at");
CREATE INDEX IF NOT EXISTS "user_sessions_org_id_login_at_idx"
  ON "user_sessions" ("org_id", "login_at");

DO $$ BEGIN
  ALTER TABLE "user_sessions"
    ADD CONSTRAINT "user_sessions_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_sessions"
    ADD CONSTRAINT "user_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. register_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS "register_requests" (
  "id"               UUID NOT NULL,
  "org_id"           UUID NOT NULL,
  "name"             TEXT NOT NULL,
  "phone"            TEXT NOT NULL,
  "email"            TEXT,
  "branch_id"        UUID,
  "requested_role"   TEXT NOT NULL,
  "notes"            TEXT,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by_id"   UUID,
  "reviewed_at"      TIMESTAMPTZ(6),
  "reject_reason"    TEXT,
  "result_user_id"   UUID,
  "ip_address"       INET,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "register_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "register_requests_org_status_created_idx"
  ON "register_requests" ("org_id", "status", "created_at");

DO $$ BEGIN
  ALTER TABLE "register_requests"
    ADD CONSTRAINT "register_requests_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "register_requests"
    ADD CONSTRAINT "register_requests_reviewer_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. org_modules
-- ============================================================
CREATE TABLE IF NOT EXISTS "org_modules" (
  "id"             UUID NOT NULL,
  "org_id"         UUID NOT NULL,
  "module_name"    TEXT NOT NULL,
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "activated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivated_at" TIMESTAMPTZ(6),
  CONSTRAINT "org_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_modules_org_module_uniq"
  ON "org_modules" ("org_id", "module_name");

DO $$ BEGIN
  ALTER TABLE "org_modules"
    ADD CONSTRAINT "org_modules_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed Pooilgroup org with all 3 modules active
INSERT INTO "org_modules" (id, org_id, module_name, is_active)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  m.name,
  true
FROM (VALUES ('cashhub'), ('fuelos'), ('docuflow')) AS m(name)
ON CONFLICT (org_id, module_name) DO NOTHING;

-- ============================================================
-- 5. branch_groups + branch_group_members
-- ============================================================
CREATE TABLE IF NOT EXISTS "branch_groups" (
  "id"         UUID NOT NULL,
  "org_id"     UUID NOT NULL,
  "name"       TEXT NOT NULL,
  "emoji"      TEXT,
  "group_type" TEXT NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "branch_groups_org_type_idx"
  ON "branch_groups" ("org_id", "group_type");

DO $$ BEGIN
  ALTER TABLE "branch_groups"
    ADD CONSTRAINT "branch_groups_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "branch_group_members" (
  "id"        UUID NOT NULL,
  "group_id"  UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  CONSTRAINT "branch_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bgm_uniq"
  ON "branch_group_members" ("group_id", "branch_id");
CREATE INDEX IF NOT EXISTS "bgm_branch_idx"
  ON "branch_group_members" ("branch_id");

DO $$ BEGIN
  ALTER TABLE "branch_group_members"
    ADD CONSTRAINT "bgm_group_fkey"
    FOREIGN KEY ("group_id") REFERENCES "branch_groups"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 6. holidays
-- ============================================================
CREATE TABLE IF NOT EXISTS "holidays" (
  "id"          UUID NOT NULL,
  "org_id"      UUID NOT NULL,
  "date"        DATE NOT NULL,
  "name"        TEXT NOT NULL,
  "is_org_wide" BOOLEAN NOT NULL DEFAULT true,
  "branch_ids"  UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "holidays_org_date_uniq"
  ON "holidays" ("org_id", "date");

DO $$ BEGIN
  ALTER TABLE "holidays"
    ADD CONSTRAINT "holidays_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 7. telegram_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS "telegram_subscriptions" (
  "id"        UUID NOT NULL,
  "org_id"    UUID NOT NULL,
  "user_id"   UUID NOT NULL,
  "bot_name"  TEXT NOT NULL,
  "chat_id"   TEXT NOT NULL,
  "username"  TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ts_user_bot_uniq"
  ON "telegram_subscriptions" ("user_id", "bot_name");
CREATE INDEX IF NOT EXISTS "ts_org_bot_active_idx"
  ON "telegram_subscriptions" ("org_id", "bot_name", "is_active");

DO $$ BEGIN
  ALTER TABLE "telegram_subscriptions"
    ADD CONSTRAINT "ts_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "telegram_subscriptions"
    ADD CONSTRAINT "ts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 8. telegram_groups
-- ============================================================
CREATE TABLE IF NOT EXISTS "telegram_groups" (
  "id"         UUID NOT NULL,
  "org_id"     UUID NOT NULL,
  "bot_name"   TEXT NOT NULL,
  "chat_id"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "module"     TEXT NOT NULL,
  "scope"      JSONB NOT NULL DEFAULT '{}',
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tg_chat_uniq"
  ON "telegram_groups" ("chat_id");
CREATE INDEX IF NOT EXISTS "tg_org_module_active_idx"
  ON "telegram_groups" ("org_id", "module", "is_active");

DO $$ BEGIN
  ALTER TABLE "telegram_groups"
    ADD CONSTRAINT "tg_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 9. telegram_pairing_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS "telegram_pairing_tokens" (
  "id"         UUID NOT NULL,
  "org_id"     UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "token"      TEXT NOT NULL,
  "bot_name"   TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_pairing_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tpt_token_uniq"
  ON "telegram_pairing_tokens" ("token");
CREATE INDEX IF NOT EXISTS "tpt_user_used_idx"
  ON "telegram_pairing_tokens" ("user_id", "used_at");

DO $$ BEGIN
  ALTER TABLE "telegram_pairing_tokens"
    ADD CONSTRAINT "tpt_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "telegram_pairing_tokens"
    ADD CONSTRAINT "tpt_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- RLS Policies — every new table is org-scoped
-- ============================================================
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "register_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_pairing_tokens" ENABLE ROW LEVEL SECURITY;

-- notifications: user reads own; admin reads org
DROP POLICY IF EXISTS notifications_self_read ON public.notifications;
CREATE POLICY notifications_self_read ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- user_sessions: user reads/revokes own; admin reads org
DROP POLICY IF EXISTS user_sessions_self_read ON public.user_sessions;
CREATE POLICY user_sessions_self_read ON public.user_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS user_sessions_self_update ON public.user_sessions;
CREATE POLICY user_sessions_self_update ON public.user_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- register_requests: only admins read
DROP POLICY IF EXISTS register_requests_admin_read ON public.register_requests;
CREATE POLICY register_requests_admin_read ON public.register_requests
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.is_super_admin());

-- org_modules: org members read
DROP POLICY IF EXISTS org_modules_org_read ON public.org_modules;
CREATE POLICY org_modules_org_read ON public.org_modules
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

-- branch_groups: org members read
DROP POLICY IF EXISTS branch_groups_org_read ON public.branch_groups;
CREATE POLICY branch_groups_org_read ON public.branch_groups
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS bgm_org_read ON public.branch_group_members;
CREATE POLICY bgm_org_read ON public.branch_group_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.branch_groups g
      WHERE g.id = branch_group_members.group_id
        AND g.org_id = public.current_org_id()
    )
  );

-- holidays: org members read
DROP POLICY IF EXISTS holidays_org_read ON public.holidays;
CREATE POLICY holidays_org_read ON public.holidays
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

-- telegram tables: user reads own; admin reads org
DROP POLICY IF EXISTS ts_self_read ON public.telegram_subscriptions;
CREATE POLICY ts_self_read ON public.telegram_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS tg_org_read ON public.telegram_groups;
CREATE POLICY tg_org_read ON public.telegram_groups
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS tpt_self_read ON public.telegram_pairing_tokens;
CREATE POLICY tpt_self_read ON public.telegram_pairing_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- Done. Run this in Supabase SQL Editor after setup.sql.
-- All admin writes happen via service_role (bypasses RLS).
-- ============================================================
