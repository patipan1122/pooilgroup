-- LedgerLine — Phase 2 (LINE experience parity + Google Drive storage)
-- 2026-06-03 · Adds: per-group branch binding + channel defaults/rich-menu,
-- Drive storage refs on expense, LINE member (scoped) + scoped invite tables.
--
-- Pattern mirrors 20260602190000_ledger_module_init.sql (RLS org_id =
-- current_org_id() OR is_super_admin()). Idempotent — safe to re-run.
-- Apply with: supabase db push  (or Mgmt API). Column types match schema.prisma.

-- ============================================================
-- 1. ledger_line_channel — group↔branch binding + channel defaults
-- ============================================================
ALTER TABLE public.ledger_line_channel
  ADD COLUMN IF NOT EXISTS branch_id              uuid,                       -- group = THIS branch (null = central group)
  ADD COLUMN IF NOT EXISTS kind                   text NOT NULL DEFAULT 'central', -- 'branch' | 'central' | 'dm'
  ADD COLUMN IF NOT EXISTS default_payment_method text,
  ADD COLUMN IF NOT EXISTS default_category_id    uuid,
  ADD COLUMN IF NOT EXISTS rich_menu_id           text;

DO $$ BEGIN
  ALTER TABLE public.ledger_line_channel
    ADD CONSTRAINT ledger_line_channel_branch_fk
    FOREIGN KEY (branch_id) REFERENCES public.branches (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- 2. ledger_expense — Google Drive storage refs + central-group pending tag
-- ============================================================
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS drive_file_id      text,    -- Google Drive file id (receipt original)
  ADD COLUMN IF NOT EXISTS drive_web_url      text,    -- shareable Drive link for the accountant
  ADD COLUMN IF NOT EXISTS branch_tag_pending boolean NOT NULL DEFAULT false; -- central group, branch not yet chosen

CREATE INDEX IF NOT EXISTS ledger_expense_branch_pending_idx
  ON public.ledger_expense (org_id, company_id, branch_tag_pending);

-- ============================================================
-- 3. ledger_line_member — who may capture via LINE + their scope
--    (CEO model: invite people, scoped to which branches/categories they own)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_line_member (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  company_id             uuid NOT NULL,
  line_user_id           text NOT NULL,         -- verified LINE userId (from LIFF/OAuth id_token)
  pool_user_id           uuid,                  -- linked Pool user (optional)
  display_name           text,
  role                   text NOT NULL DEFAULT 'staff', -- 'staff' | 'admin' | 'accountant'
  scope_branch_ids       uuid[] NOT NULL DEFAULT '{}',  -- branches this member oversees (empty = all)
  scope_category_ids     uuid[] NOT NULL DEFAULT '{}',  -- categories (empty = all)
  default_payment_method text,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_line_member_org_lineuser_key
  ON public.ledger_line_member (org_id, line_user_id);
CREATE INDEX IF NOT EXISTS ledger_line_member_org_company_active_idx
  ON public.ledger_line_member (org_id, company_id, active);

-- ============================================================
-- 4. ledger_line_invite — scoped onboarding link (branch/category)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_line_invite (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  company_id         uuid NOT NULL,
  token              text NOT NULL,         -- random; embedded in the invite link
  role               text NOT NULL DEFAULT 'staff',
  scope_branch_ids   uuid[] NOT NULL DEFAULT '{}',
  scope_category_ids uuid[] NOT NULL DEFAULT '{}',
  note               text,
  expires_at         timestamptz,
  used_by_line_user_id text,
  used_at            timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_line_invite_token_key
  ON public.ledger_line_invite (token);
CREATE INDEX IF NOT EXISTS ledger_line_invite_org_company_idx
  ON public.ledger_line_invite (org_id, company_id);

-- ============================================================
-- RLS — org isolation (mirror current_org_id() pattern)
-- ============================================================
ALTER TABLE public.ledger_line_member ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_line_member_org_isolation" ON public.ledger_line_member;
CREATE POLICY "ledger_line_member_org_isolation" ON public.ledger_line_member
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_line_invite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_line_invite_org_isolation" ON public.ledger_line_invite;
CREATE POLICY "ledger_line_invite_org_isolation" ON public.ledger_line_invite
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- Verification (run manually after apply)
-- ============================================================
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='ledger_line_channel' AND column_name IN
--     ('branch_id','kind','default_payment_method','default_category_id','rich_menu_id');
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename IN ('ledger_line_member','ledger_line_invite');
