-- LedgerLine — RLS policy for ledger_email_connection + ledger_email_message.
-- 2026-06-07
--
-- Both tables were created with RLS ENABLED but NO policy
-- (20260606140000_ledger_email_connection.sql comment: "RLS on, no policies:
-- server-side only (Prisma admin client bypasses). The refresh token never
-- leaves the server; no anon/authenticated read path.").
--
-- Adding org-isolation policies consistent with every other LedgerLine table.
-- The service role bypasses RLS automatically (Supabase built-in).
-- These policies restrict authenticated non-service-role access to the caller's
-- org only — a safety net for any future direct-client path.
--
-- Pattern: current_org_id() + is_super_admin() (from 20260602190000 + module init).
-- Idempotent: DROP IF EXISTS + CREATE.

-- ============================================================
-- 1. ledger_email_connection — per-mailbox Gmail OAuth credential store
-- ============================================================
-- RLS already enabled in 20260606140000; ENABLE is a no-op.
ALTER TABLE public.ledger_email_connection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_email_connection_org_isolation" ON public.ledger_email_connection;
CREATE POLICY "ledger_email_connection_org_isolation" ON public.ledger_email_connection
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. ledger_email_message — per-message dedup / audit log
-- ============================================================
-- RLS already enabled in 20260606150000; ENABLE is a no-op.
ALTER TABLE public.ledger_email_message ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_email_message_org_isolation" ON public.ledger_email_message;
CREATE POLICY "ledger_email_message_org_isolation" ON public.ledger_email_message
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
