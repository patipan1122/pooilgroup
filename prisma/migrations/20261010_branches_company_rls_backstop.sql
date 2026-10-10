-- Company-scoped RLS backstop for public.branches (Phase 1 — CEO decision 2026-10-10).
--
-- Context: the company-switcher header (components/layout/company-switcher.tsx)
-- picks ONE of the org's companies (Pool Oil / JP Sync Group) and is supposed to
-- scope every page to it. Audit found it was cosmetic for /branches — the page
-- queried ALL branches of both companies regardless of the switcher, because
-- there is zero RLS policy anywhere referencing company_id (unlike org_id,
-- which has a real backstop since supabase/migrations/20260504000001_rls_and_jwt_claim.sql).
--
-- This migration adds that backstop for branches specifically, so that even a
-- future query that forgets `.eq("company_id", ...)` still only returns the
-- requesting company's rows, as long as it runs through serverClient() (RLS-
-- enforcing) rather than adminClient() (service_role, bypasses RLS entirely —
-- unaffected by this migration, by design, same as org_id's backstop).
--
-- Why this can't reuse the org_id pattern as-is: org_id is an identity
-- attribute (1 user → 1 org, set once per session via a JWT custom claim).
-- company_id is NOT identity — the same admin legitimately works in either
-- company, picking one per REQUEST via the switcher cookie, not per session.
-- So the policy can't read a JWT claim; it reads a request header instead
-- (`x-company-id`, set by serverClient({ companyId }) in lib/db/server.ts),
-- using the same `current_setting('request.headers', true)::json->>'...'`
-- mechanism PostgREST already exposes for this exact purpose.
--
-- ============================================================
-- 1. Helper function: read the company_id the current REQUEST declared
--    (not the user's identity — mirrors current_org_id()'s style/shape).
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_selected_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.headers', true)::json ->> 'x-company-id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.current_selected_company_id() IS
  'Returns the company_id the current request declared via the x-company-id '
  'header (set by serverClient({ companyId }) — see lib/db/server.ts). NULL '
  'when the request did not send the header, e.g. anything still on '
  'adminClient() or a route not yet converted — see lib/db/RLS_REFACTOR.md.';

-- ============================================================
-- 2. RLS backstop policy on public.branches.
--
-- NOTE: public.branches ALREADY has RLS enabled + an existing policy
-- (branches_org_isolation, from the 2026-05-04 org_id migration) — verified
-- live via pg introspection before writing this file, so this migration does
-- NOT re-run ALTER TABLE ... ENABLE ROW LEVEL SECURITY (would be a harmless
-- no-op, but the existing policy is left untouched, not dropped/replaced, per
-- the Phase 1 brief).
--
-- THIS MUST BE A RESTRICTIVE POLICY, NOT A SECOND PERMISSIVE ONE.
-- Postgres combines multiple PERMISSIVE policies for the same command with
-- OR. If this were added as a normal (permissive) policy, the final check
-- would become "org-isolation-allows OR company-scope-allows" — and because
-- this policy's own condition allows everything when the header is absent
-- (current_selected_company_id() IS NULL), a plain-permissive version of this
-- policy would have OR'd that NULL-passthrough into the access decision and
-- actually punched a hole THROUGH branches_org_isolation (any authenticated
-- user, any org, whenever no header is sent) — the opposite of a backstop.
--
-- RESTRICTIVE policies are ANDed with the OR of all permissive policies, so
-- the real effective rule becomes:
--   branches_org_isolation (permissive)  AND  this policy (restrictive)
-- i.e. a row must still pass org isolation AND (no header sent, OR the row's
-- company matches the declared header, OR the user is super_admin). That is
-- the intended "degrade to org_id-only protection when no header is sent, and
-- additionally restrict to the declared company when a header IS sent" — the
-- conservative Phase 1 behavior the brief describes, not a new way to leak.
-- ============================================================
DROP POLICY IF EXISTS branches_company_scope ON public.branches;
CREATE POLICY branches_company_scope ON public.branches
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    current_selected_company_id() IS NULL
    OR company_id = current_selected_company_id()
    OR public.is_super_admin()
  )
  WITH CHECK (
    current_selected_company_id() IS NULL
    OR company_id = current_selected_company_id()
    OR public.is_super_admin()
  );

-- ============================================================
-- Done. Still bypassed entirely by adminClient() (service_role) — the other
-- 3 parallel queries on /branches (companies/users/user_branches) stay on
-- adminClient() by design, per Phase 1 scope; only the branches read itself
-- was converted to serverClient({ companyId }) in app/(admin)/branches/page.tsx.
-- ============================================================
