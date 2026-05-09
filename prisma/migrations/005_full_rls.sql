-- Migration 005: Enable RLS on remaining 18 multi-tenant tables
-- Defense-in-depth (Phase 2 SaaS prerequisite)
--
-- Pattern: org_id-scoped read+write policies
-- Service role bypasses RLS automatically — server-side admin client works as-is
-- Idempotent — safe to re-run

-- ============================================================
-- Helper: current_org_id() — extract org from authenticated user
-- ============================================================
-- Already exists in setup.sql as SECURITY DEFINER function
-- public.current_org_id() returns the org_id of the auth.uid() user

-- ============================================================
-- Helper macro pattern (PostgreSQL doesn't have macros — repeat per table)
-- ============================================================

-- 1. companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_org_isolation ON public.companies;
CREATE POLICY companies_org_isolation ON public.companies
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 2. branch_rentals
ALTER TABLE public.branch_rentals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_rentals_org_isolation ON public.branch_rentals;
CREATE POLICY branch_rentals_org_isolation ON public.branch_rentals
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 3. user_modules
ALTER TABLE public.user_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_modules_org_isolation ON public.user_modules;
CREATE POLICY user_modules_org_isolation ON public.user_modules
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 4. branch_targets
ALTER TABLE public.branch_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_targets_org_isolation ON public.branch_targets;
CREATE POLICY branch_targets_org_isolation ON public.branch_targets
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 5. branch_health_scores
ALTER TABLE public.branch_health_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_health_scores_org_isolation ON public.branch_health_scores;
CREATE POLICY branch_health_scores_org_isolation ON public.branch_health_scores
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 6. branch_streaks
ALTER TABLE public.branch_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_streaks_org_isolation ON public.branch_streaks;
CREATE POLICY branch_streaks_org_isolation ON public.branch_streaks
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 7. missing_report_reasons
ALTER TABLE public.missing_report_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS missing_report_reasons_org_isolation ON public.missing_report_reasons;
CREATE POLICY missing_report_reasons_org_isolation ON public.missing_report_reasons
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 8. documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_org_isolation ON public.documents;
CREATE POLICY documents_org_isolation ON public.documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 9. document_ownership
ALTER TABLE public.document_ownership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_ownership_org_isolation ON public.document_ownership;
CREATE POLICY document_ownership_org_isolation ON public.document_ownership
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 10. document_tags
ALTER TABLE public.document_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_tags_org_isolation ON public.document_tags;
CREATE POLICY document_tags_org_isolation ON public.document_tags
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 11. document_renewals
ALTER TABLE public.document_renewals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_renewals_org_isolation ON public.document_renewals;
CREATE POLICY document_renewals_org_isolation ON public.document_renewals
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 12. document_shared_branches
ALTER TABLE public.document_shared_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_shared_branches_org_isolation ON public.document_shared_branches;
CREATE POLICY document_shared_branches_org_isolation ON public.document_shared_branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 13. vehicles
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicles_org_isolation ON public.vehicles;
CREATE POLICY vehicles_org_isolation ON public.vehicles
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 14. vehicle_documents
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_documents_org_isolation ON public.vehicle_documents;
CREATE POLICY vehicle_documents_org_isolation ON public.vehicle_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 15. person_documents
ALTER TABLE public.person_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS person_documents_org_isolation ON public.person_documents;
CREATE POLICY person_documents_org_isolation ON public.person_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 16. document_signature_placements
ALTER TABLE public.document_signature_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_signature_placements_org_isolation ON public.document_signature_placements;
CREATE POLICY document_signature_placements_org_isolation ON public.document_signature_placements
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 17. document_analyses
ALTER TABLE public.document_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_analyses_org_isolation ON public.document_analyses;
CREATE POLICY document_analyses_org_isolation ON public.document_analyses
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- 18. ai_search_cache
ALTER TABLE public.ai_search_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_search_cache_org_isolation ON public.ai_search_cache;
CREATE POLICY ai_search_cache_org_isolation ON public.ai_search_cache
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ============================================================
-- Verify — list all tables that still don't have RLS
-- ============================================================
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- AND rowsecurity = false
-- AND tablename NOT IN ('schema_migrations', '_prisma_migrations')
-- ORDER BY tablename;
