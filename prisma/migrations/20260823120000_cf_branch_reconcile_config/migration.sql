-- ClawFleet · ผูกบัญชีธนาคาร/บริษัทต่อสาขา สำหรับส่งยอดฝากเข้า reconcile (LedgerLine)
-- (CEO 2026-08-23 · ต่อยอดจาก ChairOps reconcile_account pattern
--  20260815120000_chairops_branch_reconcile_account — แต่แยกเป็นตารางใหม่แทนการ
--  ADD COLUMN บน Branch เพราะ Branch เป็นตารางที่ใช้ร่วมกับอีก 8 โปรแกรม
--  (cashhub/chairops/clawhub/docuflow/ledger/playland/repairs).
-- 1 แถวต่อสาขา (branch_id unique) · ADDITIVE · ไม่กระทบตารางเดิม.
-- company_id/bank_account_id ไม่ใส่ FK ตรง ๆ (mirror ChairopsBranch.reconcileCompanyId/
-- reconcileBankAccountId เดิม — ledger_bank_account อยู่นอก schema ที่ Prisma track).
CREATE TABLE IF NOT EXISTS public.cf_branch_reconcile_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_branch_reconcile_configs_org_idx
  ON public.cf_branch_reconcile_configs (org_id);
