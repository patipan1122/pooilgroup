-- Pooilgroup ERP — in-app bug report system
--
-- 2026-05-20 (CEO request): ปุ่มแจ้งบัคซ่อนใต้ปุ่ม AI floating ทุกหน้า
-- พนักงานเจอบัคไหน → กดแจ้ง + แนบ screenshot → admin ดูที่ /bugs
-- → Claude session ใหม่อ่าน table นี้เพื่อ batch-fix
--
-- Self-contained migration (CREATE TABLE + RLS in 1 SQL) — paste in Supabase
-- SQL Editor. Replaces `prisma db push` to avoid mid-session terminal step.

-- ============================================================
-- 1. Status enum
-- ============================================================
DO $$ BEGIN
  CREATE TYPE "BugStatus" AS ENUM ('new', 'acked', 'fixed', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bug_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  description         text NOT NULL,
  screenshot_key      text,
  user_agent          text,
  status              "BugStatus" NOT NULL DEFAULT 'new',
  admin_note          text,
  acknowledged_by_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at     timestamptz(6),
  fixed_at            timestamptz(6),
  fixed_commit_sha    text,
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_at          timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_reports_org_status_created_idx
  ON public.bug_reports (org_id, status, created_at);

CREATE INDEX IF NOT EXISTS bug_reports_reporter_created_idx
  ON public.bug_reports (reporter_id, created_at);

-- ============================================================
-- 3. RLS + org_isolation policy
-- ============================================================
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bug_reports_org_isolation" ON public.bug_reports;
CREATE POLICY "bug_reports_org_isolation"
  ON public.bug_reports
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 4. Verify (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename='bug_reports';
--
--   SELECT policyname FROM pg_policies
--   WHERE schemaname='public' AND tablename='bug_reports';
