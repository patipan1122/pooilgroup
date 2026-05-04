-- Pool Group ERP — RLS Policies + JWT Custom Claim
-- Run after `prisma migrate deploy` to apply RLS to Prisma-created tables
-- Multi-tenant: every query is scoped to org_id from JWT

-- ============================================================
-- 1. Helper function: read current user's org_id from JWT
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.current_org_id() IS
  'Returns the org_id from the JWT custom claim. NULL when no JWT (anon).';

-- ============================================================
-- 2. Helper: check if current user is super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND is_active = true
  );
$$;

-- ============================================================
-- 3. Auth hook: inject org_id + role into JWT custom claims
-- Supabase calls this for every JWT mint
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  user_record record;
BEGIN
  claims := event -> 'claims';

  SELECT id, org_id, role
  INTO user_record
  FROM public.users
  WHERE id = (event ->> 'user_id')::uuid
    AND is_active = true;

  IF user_record.org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_record.org_id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(user_record.role::text));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- After running this migration, in Supabase Dashboard:
-- Authentication → Hooks → Custom Access Token Hook → Enable + select custom_access_token_hook

-- ============================================================
-- 4. Enable RLS on all tenant tables
-- ============================================================
ALTER TABLE public.organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shortages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Policies — org isolation pattern
--    Every authenticated user can only see rows in their own org.
--    super_admin bypasses (sees all orgs — for support/debug only).
-- ============================================================

-- organizations: user can read their own org
DROP POLICY IF EXISTS org_self_read ON public.organizations;
CREATE POLICY org_self_read ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_org_id() OR public.is_super_admin());

-- users: same-org read, self-update
DROP POLICY IF EXISTS users_same_org_read ON public.users;
CREATE POLICY users_same_org_read ON public.users
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- branches
DROP POLICY IF EXISTS branches_org_isolation ON public.branches;
CREATE POLICY branches_org_isolation ON public.branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- user_branches
DROP POLICY IF EXISTS user_branches_org_isolation ON public.user_branches;
CREATE POLICY user_branches_org_isolation ON public.user_branches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- report_templates
DROP POLICY IF EXISTS report_templates_org_isolation ON public.report_templates;
CREATE POLICY report_templates_org_isolation ON public.report_templates
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- daily_reports
DROP POLICY IF EXISTS daily_reports_org_isolation ON public.daily_reports;
CREATE POLICY daily_reports_org_isolation ON public.daily_reports
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- cash_shortages
DROP POLICY IF EXISTS cash_shortages_org_isolation ON public.cash_shortages;
CREATE POLICY cash_shortages_org_isolation ON public.cash_shortages
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- audit_logs: same-org read; insert allowed but immutable
DROP POLICY IF EXISTS audit_logs_org_read ON public.audit_logs;
CREATE POLICY audit_logs_org_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id());

-- ============================================================
-- 6. Index for fast JWT claim lookup
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_auth_lookup
  ON public.users (id, is_active);

-- ============================================================
-- Done. Service role (used in server-side admin endpoints) bypasses RLS.
-- All client/RPC calls go through anon or authenticated → RLS enforced.
-- ============================================================
