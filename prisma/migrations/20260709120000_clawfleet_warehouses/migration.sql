-- ClawFleet warehouses — multiple stock rooms per branch. Additive only. No Branch table changes.
-- SAFETY INVARIANT: warehouse_id is nullable · null = branch's MAIN warehouse.
-- All existing branch-total on-hand views stay identical (aggregate reads don't filter warehouse_id).

-- B1 · New table cf_warehouses
CREATE TABLE IF NOT EXISTS public.cf_warehouses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  is_main       boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_warehouses_org_branch_idx
  ON public.cf_warehouses (org_id, branch_id, sort_order);
-- exactly ONE main per branch (partial-unique · mirrors cf_events_one_baseline_per_machine pattern)
CREATE UNIQUE INDEX IF NOT EXISTS cf_warehouses_one_main_per_branch
  ON public.cf_warehouses (branch_id) WHERE is_main;

-- B2 · Add nullable warehouse_id FK to movement ledger + doc heads
-- null = branch's MAIN warehouse (SAFETY INVARIANT). ON DELETE SET NULL → deactivate never orphans ledger.
ALTER TABLE public.cf_stock_movements
  ADD COLUMN IF NOT EXISTS warehouse_id uuid
    REFERENCES public.cf_warehouses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cf_stock_movements_wh_idx
  ON public.cf_stock_movements (org_id, branch_id, warehouse_id, product_id);

-- receipt/count are warehouse-scoped documents (which room was received into / counted)
ALTER TABLE public.cf_goods_receipts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid
    REFERENCES public.cf_warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.cf_stock_counts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid
    REFERENCES public.cf_warehouses(id) ON DELETE SET NULL;
-- (cf_loss_docs left branch-scoped for v1 — loss is not room-critical; can add later if needed)

-- C · BACKFILL — one MAIN warehouse per existing claw_machine branch.
-- Idempotent (skip if branch already has a main). Existing movement.warehouse_id stays NULL (null = main).
-- created_by_id fallback = oldest org user (system actor); if an org has 0 users the row is skipped (harmless).
INSERT INTO public.cf_warehouses (org_id, branch_id, name, is_main, sort_order, created_by_id)
SELECT b.org_id, b.id, 'คลังหลัก', true, 0,
       (SELECT u.id FROM public.users u WHERE u.org_id = b.org_id ORDER BY u.created_at ASC LIMIT 1)
FROM public.branches b
WHERE b.business_type = 'claw_machine'
  AND (SELECT u.id FROM public.users u WHERE u.org_id = b.org_id ORDER BY u.created_at ASC LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.cf_warehouses w WHERE w.branch_id = b.id AND w.is_main);
