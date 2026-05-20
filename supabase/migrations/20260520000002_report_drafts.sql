-- Pooilgroup ERP — server-side draft autosave for CashHub report form.
--
-- 2026-05-20 (Branch Manager audit): localStorage หายเมื่อเปลี่ยนเครื่อง
-- → ย้าย autosave เข้า DB · auto-delete หลัง report submit สำเร็จ.
-- Unique per (user, branch, date, shift) — 1 draft ต่อบริบทเดียว.
--
-- Pattern: matches existing RLS migrations (org_id-direct policy).
-- Run order: AFTER `prisma db push` creates the table.

-- ============================================================
-- 1. Table is created by Prisma (`prisma db push` from schema.prisma model
--    ReportDraft). This migration only handles the parts Prisma can't:
--      • RLS enable + policy
-- ============================================================

ALTER TABLE public.report_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_drafts_org_isolation" ON public.report_drafts;
CREATE POLICY "report_drafts_org_isolation"
  ON public.report_drafts
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. Verification (run manually after apply)
-- ============================================================
--   SELECT rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename='report_drafts';
--   -- should be true
