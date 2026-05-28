-- Pooilgroup ERP — RLS for the last 6 tables that Tech Lead audit flagged.
--
-- Deep audit 2026-05-20 (Tech Lead persona): 52 Prisma models map to tables
-- but only 46 had RLS enabled. The remaining 6 are:
--   • companies         — entities under an org (5 บริษัทในเครือของ PO Oil)
--   • branch_rentals    — สัญญาเช่าพื้นที่สาขา (sensitive financial data)
--   • user_modules      — per-user module access toggles (permission scope)
--   • ai_search_cache   — DocuFlow AI search cache
--   • document_analyses — AI risk/summary analysis cache
--   • document_signature_placements — signature box positions
--
-- Pattern: matches 20260504000001_rls_and_jwt_claim.sql +
--          20260508000007_rls_for_remaining_tables.sql
--   - All 6 tables have an `org_id uuid` column → direct policy
--   - WHERE org_id = current_org_id() OR is_super_admin()
--   - service role (adminClient) bypasses RLS — server endpoints unaffected
--
-- Why now: every route that touches these 6 tables currently relies on
-- application-level filtering (e.g. `.eq("org_id", session.user.org_id)`).
-- If a future caller forgets that filter, the row leaks across orgs.
-- RLS = defense in depth.
--
-- Run order: AFTER `prisma db push` / `prisma migrate deploy` creates the tables.

-- ============================================================
-- 1. Enable RLS on the 6 tables
-- ============================================================
ALTER TABLE public.companies                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_rentals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_modules                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_cache                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_analyses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signature_placements   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Standard org_id isolation policies
-- ============================================================

-- companies
DROP POLICY IF EXISTS "companies_org_isolation" ON public.companies;
CREATE POLICY "companies_org_isolation"
  ON public.companies
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- branch_rentals
DROP POLICY IF EXISTS "branch_rentals_org_isolation" ON public.branch_rentals;
CREATE POLICY "branch_rentals_org_isolation"
  ON public.branch_rentals
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- user_modules
DROP POLICY IF EXISTS "user_modules_org_isolation" ON public.user_modules;
CREATE POLICY "user_modules_org_isolation"
  ON public.user_modules
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ai_search_cache
DROP POLICY IF EXISTS "ai_search_cache_org_isolation" ON public.ai_search_cache;
CREATE POLICY "ai_search_cache_org_isolation"
  ON public.ai_search_cache
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- document_analyses
DROP POLICY IF EXISTS "document_analyses_org_isolation" ON public.document_analyses;
CREATE POLICY "document_analyses_org_isolation"
  ON public.document_analyses
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- document_signature_placements
DROP POLICY IF EXISTS "document_signature_placements_org_isolation"
  ON public.document_signature_placements;
CREATE POLICY "document_signature_placements_org_isolation"
  ON public.document_signature_placements
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 3. Verification queries (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'companies','branch_rentals','user_modules',
--       'ai_search_cache','document_analyses','document_signature_placements'
--     );
--   -- All 6 should have rowsecurity = true
--
--   SELECT tablename, policyname
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'companies','branch_rentals','user_modules',
--       'ai_search_cache','document_analyses','document_signature_placements'
--     );
--   -- Each table should have its _org_isolation policy
