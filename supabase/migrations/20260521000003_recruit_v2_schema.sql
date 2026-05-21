-- Pooilgroup ERP — Recruit v2 schema (Phase B-full per design canvas)
-- 2026-05-21 · 5 new tables: recruit_interviews, recruit_messages,
--   recruit_screening_rules, recruit_referrals, recruit_erasure_requests
--
-- Pattern: matches existing recruit RLS (org_id-direct policy).
-- Run AFTER `prisma db push` creates the tables.

-- ============================================================
-- recruit_interviews
-- ============================================================
ALTER TABLE public.recruit_interviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_interviews_org_isolation" ON public.recruit_interviews;
CREATE POLICY "recruit_interviews_org_isolation"
  ON public.recruit_interviews
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- recruit_messages
-- ============================================================
ALTER TABLE public.recruit_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_messages_org_isolation" ON public.recruit_messages;
CREATE POLICY "recruit_messages_org_isolation"
  ON public.recruit_messages
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- recruit_screening_rules
-- ============================================================
ALTER TABLE public.recruit_screening_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_screening_rules_org_isolation" ON public.recruit_screening_rules;
CREATE POLICY "recruit_screening_rules_org_isolation"
  ON public.recruit_screening_rules
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- recruit_referrals
-- ============================================================
ALTER TABLE public.recruit_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_referrals_org_isolation" ON public.recruit_referrals;
CREATE POLICY "recruit_referrals_org_isolation"
  ON public.recruit_referrals
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- Public referral lookup by code (no auth required) — handled at app layer
-- via adminClient() bypass.

-- ============================================================
-- recruit_erasure_requests
-- ============================================================
ALTER TABLE public.recruit_erasure_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruit_erasure_requests_org_isolation" ON public.recruit_erasure_requests;
CREATE POLICY "recruit_erasure_requests_org_isolation"
  ON public.recruit_erasure_requests
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- Public erasure submission (candidate side) — handled at app layer via
-- adminClient() bypass.
