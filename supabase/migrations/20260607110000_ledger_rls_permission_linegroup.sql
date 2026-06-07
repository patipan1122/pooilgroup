-- LedgerLine — RLS policies for ledger_permission + ledger_line_group.
-- 2026-06-07
--
-- Both tables were created without RLS policies (server-side Prisma service-role
-- access is the primary path). Adding org-isolation policies now so any future
-- authenticated-client path is safe by default, and consistent with every other
-- LedgerLine table that uses current_org_id() + is_super_admin().
--
-- Pattern: identical to 20260602190000_ledger_module_init.sql and
-- 20260606120000_ledger_payments_quotations.sql. Service role bypasses all RLS
-- automatically (Supabase/Postgres built-in — no explicit policy needed for it).
-- Idempotent: ENABLE is a no-op if already on; DROP + CREATE replaces any stale policy.

-- ============================================================
-- 1. ledger_permission — role↔capability overrides (LIFF admin "สิทธิ์" tab)
-- ============================================================
ALTER TABLE public.ledger_permission ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_permission_org_isolation" ON public.ledger_permission;
CREATE POLICY "ledger_permission_org_isolation" ON public.ledger_permission
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. ledger_line_group — LINE group → branch mapping (B3 multi-group)
-- ============================================================
ALTER TABLE public.ledger_line_group ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_line_group_org_isolation" ON public.ledger_line_group;
CREATE POLICY "ledger_line_group_org_isolation" ON public.ledger_line_group
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
