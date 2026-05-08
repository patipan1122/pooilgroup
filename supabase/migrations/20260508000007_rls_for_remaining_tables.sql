-- Pooilgroup ERP — RLS for tables added after the initial RLS migration.
--
-- Audit (2026-05-08) found 17+ tables with no Row Level Security. The server
-- always uses the service role (`adminClient`) which bypasses RLS, but any
-- direct client/anon/authenticated query (including future Supabase JS in the
-- browser, Studio, or PostgREST) could leak rows across orgs.
--
-- Pattern matches 20260504000001_rls_and_jwt_claim.sql:
--   • org_id row matches public.current_org_id() (from JWT claim) OR caller is super_admin
--   • super_admin override is for cross-org support / debugging
--   • service role bypasses RLS regardless (server endpoints unaffected)
--
-- Tables covered (18):
--   branch_groups, branch_group_members
--   documents, document_ownership, document_renewals, document_shared_branches, document_tags
--   holidays
--   notifications
--   org_modules
--   person_documents
--   register_requests
--   telegram_groups, telegram_pairing_tokens, telegram_subscriptions
--   user_sessions
--   vehicles, vehicle_documents

-- ============================================================
-- 1. Enable RLS on every table that lacks it
-- ============================================================
ALTER TABLE public.branch_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ownership       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_renewals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_shared_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.register_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_pairing_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_documents        ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Standard org_id-direct policies (most tables have org_id column)
-- ============================================================

DROP POLICY IF EXISTS branch_groups_org_isolation ON public.branch_groups;
CREATE POLICY branch_groups_org_isolation ON public.branch_groups
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS documents_org_isolation ON public.documents;
CREATE POLICY documents_org_isolation ON public.documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS document_ownership_org_isolation ON public.document_ownership;
CREATE POLICY document_ownership_org_isolation ON public.document_ownership
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS document_renewals_org_isolation ON public.document_renewals;
CREATE POLICY document_renewals_org_isolation ON public.document_renewals
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS document_shared_branches_org_isolation ON public.document_shared_branches;
CREATE POLICY document_shared_branches_org_isolation ON public.document_shared_branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS document_tags_org_isolation ON public.document_tags;
CREATE POLICY document_tags_org_isolation ON public.document_tags
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS holidays_org_isolation ON public.holidays;
CREATE POLICY holidays_org_isolation ON public.holidays
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS org_modules_org_isolation ON public.org_modules;
CREATE POLICY org_modules_org_isolation ON public.org_modules
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS person_documents_org_isolation ON public.person_documents;
CREATE POLICY person_documents_org_isolation ON public.person_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS register_requests_org_isolation ON public.register_requests;
CREATE POLICY register_requests_org_isolation ON public.register_requests
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS telegram_groups_org_isolation ON public.telegram_groups;
CREATE POLICY telegram_groups_org_isolation ON public.telegram_groups
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS telegram_pairing_tokens_org_isolation ON public.telegram_pairing_tokens;
CREATE POLICY telegram_pairing_tokens_org_isolation ON public.telegram_pairing_tokens
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS telegram_subscriptions_org_isolation ON public.telegram_subscriptions;
CREATE POLICY telegram_subscriptions_org_isolation ON public.telegram_subscriptions
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS vehicles_org_isolation ON public.vehicles;
CREATE POLICY vehicles_org_isolation ON public.vehicles
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS vehicle_documents_org_isolation ON public.vehicle_documents;
CREATE POLICY vehicle_documents_org_isolation ON public.vehicle_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 3. Notifications — SELECT restricted to own user (privacy)
--    User may only mark their own as read.
--    Inserts allowed only when matching current org.
-- ============================================================

DROP POLICY IF EXISTS notifications_self_read ON public.notifications;
CREATE POLICY notifications_self_read ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (org_id = public.current_org_id() AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS notifications_self_update ON public.notifications;
CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND user_id = auth.uid())
  WITH CHECK (org_id = public.current_org_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS notifications_org_insert ON public.notifications;
CREATE POLICY notifications_org_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id());

-- ============================================================
-- 4. user_sessions — self read/write OR same-org admin (for audit)
-- ============================================================

DROP POLICY IF EXISTS user_sessions_self_or_admin ON public.user_sessions;
CREATE POLICY user_sessions_self_or_admin ON public.user_sessions
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR org_id = public.current_org_id()
  )
  WITH CHECK (
    public.is_super_admin()
    OR (user_id = auth.uid() AND org_id = public.current_org_id())
  );

-- ============================================================
-- 5. branch_group_members — chain via parent branch_groups (no org_id col)
-- ============================================================

DROP POLICY IF EXISTS branch_group_members_isolation ON public.branch_group_members;
CREATE POLICY branch_group_members_isolation ON public.branch_group_members
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.branch_groups g
      WHERE g.id = branch_group_members.group_id
        AND g.org_id = public.current_org_id()
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.branch_groups g
      WHERE g.id = branch_group_members.group_id
        AND g.org_id = public.current_org_id()
    )
  );

-- ============================================================
-- Done. Service role still bypasses RLS (server endpoints unaffected).
-- After this migration ALL Prisma tables in the schema are RLS-gated.
-- ============================================================
