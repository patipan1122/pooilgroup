-- LedgerLine — Inventory STOCK-IN v1.1: per-branch SKU scoping + multi-unit packs.
--
-- Builds on 20260607170000 (ledger_trcloud_sku + ledger_sku_alias). ADDITIVE — with
-- the LEDGER_STOCKIN_V1 flag OFF nothing reads these, so runtime is unchanged.
--
-- Why:
--   1) ledger_sku_branch — assign a cached SKU to the branch(es) that actually buy it.
--      Empty assignment = available to every branch (back-compat). When a SKU HAS
--      assignments, a stock-IN from a non-listed branch is flagged (กันคีย์ผิดสาขา).
--      NOTE: TRCloud keeps ONE on-hand balance per SKU (no per-warehouse) — branch is
--      recorded as the document `project` for reporting + drives this matching guard,
--      it does NOT split the stock balance per branch.
--   2) pack_units — multiple purchase units per SKU (โหล=12, ลัง=24). The single
--      pack_factor stays as the legacy default; pack_units is the richer list the
--      accountant picks from at receive time. base unit (factor 1) is always implicit.

-- 1) SKU ↔ branch assignment.
CREATE TABLE IF NOT EXISTS public.ledger_sku_branch (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  company_id uuid NOT NULL,
  sku_id     uuid NOT NULL,
  branch_id  uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_sku_branch_sku_branch_key UNIQUE (sku_id, branch_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_sku_branch_sku_id_fkey') THEN
    ALTER TABLE public.ledger_sku_branch
      ADD CONSTRAINT ledger_sku_branch_sku_id_fkey
      FOREIGN KEY (sku_id) REFERENCES public.ledger_trcloud_sku(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_sku_branch_branch_id_fkey') THEN
    ALTER TABLE public.ledger_sku_branch
      ADD CONSTRAINT ledger_sku_branch_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ledger_sku_branch_branch_idx
  ON public.ledger_sku_branch (org_id, company_id, branch_id);
CREATE INDEX IF NOT EXISTS ledger_sku_branch_sku_idx
  ON public.ledger_sku_branch (sku_id);

-- 2) Multiple purchase units per SKU. [{ "name": "ลัง", "factor": 24 }, ...]
ALTER TABLE public.ledger_trcloud_sku
  ADD COLUMN IF NOT EXISTS pack_units jsonb NOT NULL DEFAULT '[]'::jsonb;

-- RLS — org isolation (same pattern as the other ledger tables).
ALTER TABLE public.ledger_sku_branch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_sku_branch_org_isolation" ON public.ledger_sku_branch;
CREATE POLICY "ledger_sku_branch_org_isolation" ON public.ledger_sku_branch
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

COMMENT ON TABLE public.ledger_sku_branch IS
  'ผูก SKU กับสาขาที่ใช้จริง. ว่าง=ทุกสาขา. มีรายการ=รับเข้าคลังจากสาขานอกรายการจะถูก flag. ไม่ได้แยกยอดสต๊อกรายสาขา (TRCloud นับก้อนเดียวต่อ SKU).';
COMMENT ON COLUMN public.ledger_trcloud_sku.pack_units IS
  'หลายหน่วยซื้อต่อ SKU: [{name,factor}] เช่น โหล=12, ลัง=24. base unit (factor 1) เป็น implicit เสมอ.';
