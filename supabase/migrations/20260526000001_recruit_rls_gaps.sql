-- Pooilgroup ERP · recruit module
--
-- 2026-05-26: /bigsolvebug run #1 caught 2 tables missing RLS policies
--   - recruit_inbox_channels (added 2026-05-23 with omnichannel scaffolding)
--   - recruit_form_templates (added 2026-05-22 with template save/load feature)
--
-- Both tables have org_id column · multi-tenant · MUST enforce org isolation.
-- Reference: bugsolve report `docs/BUGSOLVE_recruit_2026-05-25.md` · B-003
--
-- Apply: pnpm prisma db execute --file=supabase/migrations/20260526000001_recruit_rls_gaps.sql --schema=prisma/schema.prisma
-- DO NOT use `prisma db push` (per memory `migration-repair-without-real-apply-trap`)

-- ============================================================
-- 1. recruit_inbox_channels
-- ============================================================

ALTER TABLE public.recruit_inbox_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_inbox_channels_org_isolation" ON public.recruit_inbox_channels;
CREATE POLICY "recruit_inbox_channels_org_isolation"
  ON public.recruit_inbox_channels
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. recruit_form_templates
-- ============================================================

ALTER TABLE public.recruit_form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_form_templates_org_isolation" ON public.recruit_form_templates;
CREATE POLICY "recruit_form_templates_org_isolation"
  ON public.recruit_form_templates
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 3. Verification (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public'
--     AND tablename IN ('recruit_inbox_channels', 'recruit_form_templates');
--   -- both should be true
--
--   SELECT polname, tablename FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('recruit_inbox_channels', 'recruit_form_templates');
--   -- 2 policies expected (one per table)
