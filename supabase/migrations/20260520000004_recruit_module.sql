-- Pooilgroup ERP — RECRUIT MODULE RLS
-- 2026-05-20 · 5 ตาราง: recruit_job_postings, recruit_applicants, recruit_applications,
--                       recruit_application_notes, recruit_blacklist
--
-- Pattern: matches existing RLS migrations (org_id-direct policy).
-- Run order: AFTER `prisma db push` creates the tables.
--
-- Public access pattern:
--   - Job postings public read = handled at app layer via adminClient() in
--     /apply/[slug] route (validates slug + status=OPEN before serving)
--   - Public application submit = server action with adminClient() bypass
--   - This migration only sets ORG isolation for authenticated HR access

-- ============================================================
-- 1. RLS: recruit_job_postings
-- ============================================================
ALTER TABLE public.recruit_job_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_job_postings_org_isolation" ON public.recruit_job_postings;
CREATE POLICY "recruit_job_postings_org_isolation"
  ON public.recruit_job_postings
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. RLS: recruit_applicants
-- ============================================================
ALTER TABLE public.recruit_applicants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_applicants_org_isolation" ON public.recruit_applicants;
CREATE POLICY "recruit_applicants_org_isolation"
  ON public.recruit_applicants
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 3. RLS: recruit_applications
-- ============================================================
ALTER TABLE public.recruit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_applications_org_isolation" ON public.recruit_applications;
CREATE POLICY "recruit_applications_org_isolation"
  ON public.recruit_applications
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 4. RLS: recruit_application_notes
-- ============================================================
ALTER TABLE public.recruit_application_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_application_notes_org_isolation" ON public.recruit_application_notes;
CREATE POLICY "recruit_application_notes_org_isolation"
  ON public.recruit_application_notes
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 5. RLS: recruit_blacklist
-- ============================================================
ALTER TABLE public.recruit_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_blacklist_org_isolation" ON public.recruit_blacklist;
CREATE POLICY "recruit_blacklist_org_isolation"
  ON public.recruit_blacklist
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 6. Verification (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename LIKE 'recruit_%';
--   -- all 5 should be true
