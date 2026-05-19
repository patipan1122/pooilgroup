-- Pooilgroup ERP — FuelOS Sprint 6 foundation
-- Spec: ดีเทลv1/FUELOS.md §2 (Price Engine), §3/§14 (CRM Multi-Entity),
--       §5 (Sales Workspace), §11 (Flash Sale), §12 (Schema)
-- Plan: web/FUELOS_PLAN.md
--
-- This migration:
--   1. Adds GENERATED columns on fuel_orders that Prisma cannot express
--      (margin_per_liter, total_amount, total_profit) — see FUELOS.md §12
--   2. Adds computed line_response_log.response_minutes (sales_replied_at - customer_sent_at)
--   3. Enables Row Level Security on every new FuelOS table
--   4. Adds org-isolation policies matching the project pattern
--      (see 20260504000001_rls_and_jwt_claim.sql for current_org_id() helper)
--
-- Run order: AFTER `prisma db push` / `prisma migrate dev` creates the tables.

-- ============================================================
-- 1. Generated columns on fuel_orders (FUELOS.md §12)
--    Prisma 7.8 cannot declare GENERATED columns; we ALTER post-create.
-- ============================================================
ALTER TABLE public.fuel_orders
  DROP COLUMN IF EXISTS margin_per_liter,
  DROP COLUMN IF EXISTS total_amount,
  DROP COLUMN IF EXISTS total_profit;

ALTER TABLE public.fuel_orders
  ADD COLUMN margin_per_liter numeric(10,4)
    GENERATED ALWAYS AS (price_per_liter - depot_cost - transport_cost_per_liter) STORED,
  ADD COLUMN total_amount numeric(15,2)
    GENERATED ALWAYS AS (price_per_liter * COALESCE(qty_delivered, qty_ordered)) STORED,
  ADD COLUMN total_profit numeric(15,2)
    GENERATED ALWAYS AS (
      (price_per_liter - depot_cost - transport_cost_per_liter)
      * COALESCE(qty_delivered, qty_ordered)
    ) STORED;

COMMENT ON COLUMN public.fuel_orders.margin_per_liter IS
  'Generated: price_per_liter - depot_cost - transport_cost_per_liter (FUELOS.md §12)';
COMMENT ON COLUMN public.fuel_orders.total_amount IS
  'Generated: price_per_liter * COALESCE(qty_delivered, qty_ordered)';
COMMENT ON COLUMN public.fuel_orders.total_profit IS
  'Generated: margin_per_liter * COALESCE(qty_delivered, qty_ordered)';

-- ============================================================
-- 2. Generated column on line_response_log (FUELOS.md §12)
-- ============================================================
ALTER TABLE public.line_response_log
  DROP COLUMN IF EXISTS response_minutes;

ALTER TABLE public.line_response_log
  ADD COLUMN response_minutes integer
    GENERATED ALWAYS AS (
      CASE
        WHEN sales_replied_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (sales_replied_at - customer_sent_at))::int / 60
      END
    ) STORED;

COMMENT ON COLUMN public.line_response_log.response_minutes IS
  'Generated: minutes between customer_sent_at and sales_replied_at (NULL until reply)';

-- ============================================================
-- 3. Enable RLS on all 16 new FuelOS tables
-- ============================================================
ALTER TABLE public.depot_prices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_margins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_entities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alert_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_response_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trucks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flash_sales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_tracking      ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Org isolation policies (pattern from 20260504000001)
--    Service role bypasses RLS — server endpoints unaffected.
--    Direct authenticated client (browser/Studio) is scoped to their org.
-- ============================================================

DROP POLICY IF EXISTS depot_prices_org_isolation ON public.depot_prices;
CREATE POLICY depot_prices_org_isolation ON public.depot_prices
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS zone_margins_org_isolation ON public.zone_margins;
CREATE POLICY zone_margins_org_isolation ON public.zone_margins
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS contacts_org_isolation ON public.contacts;
CREATE POLICY contacts_org_isolation ON public.contacts
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS customer_entities_org_isolation ON public.customer_entities;
CREATE POLICY customer_entities_org_isolation ON public.customer_entities
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS delivery_locations_org_isolation ON public.delivery_locations;
CREATE POLICY delivery_locations_org_isolation ON public.delivery_locations
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS customer_quotes_org_isolation ON public.customer_quotes;
CREATE POLICY customer_quotes_org_isolation ON public.customer_quotes
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS price_alert_log_org_isolation ON public.price_alert_log;
CREATE POLICY price_alert_log_org_isolation ON public.price_alert_log
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS line_response_log_org_isolation ON public.line_response_log;
CREATE POLICY line_response_log_org_isolation ON public.line_response_log
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS fuel_orders_org_isolation ON public.fuel_orders;
CREATE POLICY fuel_orders_org_isolation ON public.fuel_orders
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS trucks_org_isolation ON public.trucks;
CREATE POLICY trucks_org_isolation ON public.trucks
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS driver_profiles_org_isolation ON public.driver_profiles;
CREATE POLICY driver_profiles_org_isolation ON public.driver_profiles
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS driver_locations_org_isolation ON public.driver_locations;
CREATE POLICY driver_locations_org_isolation ON public.driver_locations
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS payments_org_isolation ON public.payments;
CREATE POLICY payments_org_isolation ON public.payments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS flash_sales_org_isolation ON public.flash_sales;
CREATE POLICY flash_sales_org_isolation ON public.flash_sales
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS credit_documents_org_isolation ON public.credit_documents;
CREATE POLICY credit_documents_org_isolation ON public.credit_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS cheque_tracking_org_isolation ON public.cheque_tracking;
CREATE POLICY cheque_tracking_org_isolation ON public.cheque_tracking
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 5. Sanity comment
-- ============================================================
COMMENT ON TABLE public.depot_prices IS
  'FuelOS Sprint 6: ราคาคลังต่อวัน (PTT/Shell/Dao Evo) — หัวหน้ากรอกทุกเช้า';
COMMENT ON TABLE public.contacts IS
  'FuelOS Sprint 6: Contact (Multi-Entity layer 1) — คนที่คุยด้วย; group credit limit';
COMMENT ON TABLE public.customer_entities IS
  'FuelOS Sprint 6: นิติบุคคล/บุคคลธรรมดา (Multi-Entity layer 2) — invoice + credit per entity';
COMMENT ON TABLE public.delivery_locations IS
  'FuelOS Sprint 6: จุดส่งน้ำมัน (Multi-Entity layer 3) — GPS + truck size + delivery window';
COMMENT ON TABLE public.fuel_orders IS
  'FuelOS Sprint 6: ออเดอร์น้ำมัน — generated columns สำหรับ margin_per_liter / total_amount / total_profit';
