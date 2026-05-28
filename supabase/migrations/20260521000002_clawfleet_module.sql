-- Pooilgroup ERP — CLAWFLEET MODULE RLS + triggers + functions
-- 2026-05-21 · 9 tables: cf_machines, cf_machine_groups, cf_products,
--                        cf_machine_loadouts, cf_exchanger_loadouts,
--                        cf_collection_sessions, cf_collection_events,
--                        cf_stock_movements
-- Spec: docs/CLAWFLEET_PLAN.md v2
--
-- Run order: AFTER `prisma db push` creates the tables.
-- Pattern: matches existing RLS migrations (org_id-direct policy + helpers).

-- ============================================================
-- 1-8. RLS: enable + org-isolation policy per table
-- ============================================================

ALTER TABLE public.cf_machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_machines_org_isolation" ON public.cf_machines;
CREATE POLICY "cf_machines_org_isolation"
  ON public.cf_machines FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_machine_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_machine_groups_org_isolation" ON public.cf_machine_groups;
CREATE POLICY "cf_machine_groups_org_isolation"
  ON public.cf_machine_groups FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_products_org_isolation" ON public.cf_products;
CREATE POLICY "cf_products_org_isolation"
  ON public.cf_products FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_machine_loadouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_machine_loadouts_org_isolation" ON public.cf_machine_loadouts;
CREATE POLICY "cf_machine_loadouts_org_isolation"
  ON public.cf_machine_loadouts FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_exchanger_loadouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_exchanger_loadouts_org_isolation" ON public.cf_exchanger_loadouts;
CREATE POLICY "cf_exchanger_loadouts_org_isolation"
  ON public.cf_exchanger_loadouts FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_collection_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_collection_sessions_org_isolation" ON public.cf_collection_sessions;
CREATE POLICY "cf_collection_sessions_org_isolation"
  ON public.cf_collection_sessions FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_collection_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_collection_events_org_isolation" ON public.cf_collection_events;
CREATE POLICY "cf_collection_events_org_isolation"
  ON public.cf_collection_events FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.cf_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cf_stock_movements_org_isolation" ON public.cf_stock_movements;
CREATE POLICY "cf_stock_movements_org_isolation"
  ON public.cf_stock_movements FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 9. Helper function — next session code per org (atomic)
-- ============================================================
-- Format: CFS-{พ.ศ. YYYY}-{NNNNNN}  (e.g. CFS-2569-000001)
CREATE OR REPLACE FUNCTION public.cf_next_session_code(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buddhist_year TEXT;
  v_count INT;
  v_code TEXT;
BEGIN
  -- Per-org advisory lock kills race for concurrent startSession calls in same org
  PERFORM pg_advisory_xact_lock(hashtext('cf_session_code:' || p_org_id::text));

  v_buddhist_year := (EXTRACT(YEAR FROM NOW())::INT + 543)::TEXT;

  -- Count by session_code prefix instead of created_at year — robust to backfill/year boundaries
  SELECT COUNT(*) + 1
    INTO v_count
    FROM public.cf_collection_sessions
   WHERE org_id = p_org_id
     AND session_code LIKE 'CFS-' || v_buddhist_year || '-%';

  v_code := 'CFS-' || v_buddhist_year || '-' || LPAD(v_count::TEXT, 6, '0');
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cf_next_session_code(UUID) TO authenticated, service_role;

-- ============================================================
-- 10. Trigger — update machine mirror counters AFTER event insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.cf_update_machine_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update for INITIAL or COLLECTION (not VOID)
  IF NEW.event_type IN ('INITIAL', 'COLLECTION') THEN
    UPDATE public.cf_machines SET
      last_coin_meter = NEW.coin_meter_after,
      last_doll_meter = COALESCE(NEW.doll_meter_after, last_doll_meter),
      last_doll_stock = COALESCE(NEW.stock_after, last_doll_stock),
      last_event_at   = NEW.collected_at
    WHERE id = NEW.machine_id
      AND (last_event_at IS NULL OR NEW.collected_at > last_event_at);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cf_update_machine_mirror_trg ON public.cf_collection_events;
CREATE TRIGGER cf_update_machine_mirror_trg
  AFTER INSERT ON public.cf_collection_events
  FOR EACH ROW EXECUTE FUNCTION public.cf_update_machine_mirror();

-- ============================================================
-- 11. Trigger — Group cross-check on session close (HEART OF SYSTEM)
-- ============================================================
-- Computes coin reconciliation between exchanger (coins out) and
-- claw machines (coins in) within the same session.
-- Sets anomaly_flags + status=ANOMALY_REVIEW if variance > tolerance.
-- G2 BLOCK: throws exception if exchanger dispensed >0 but claws Σ=0.
CREATE OR REPLACE FUNCTION public.cf_session_close_crosscheck()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exchanger_id  UUID;
  v_tolerance_bps INT;
  v_coins_out     INT;
  v_coins_in      INT;
  v_variance_bps  INT;
  v_flags         TEXT[];
  v_total_cash    INT;
  v_event_count   INT;
  v_claw_count    INT;
BEGIN
  -- Only fire on transition OPEN → CLOSED (allow ANOMALY_REVIEW path)
  IF NEW.status NOT IN ('CLOSED', 'ANOMALY_REVIEW') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('CLOSED', 'ANOMALY_REVIEW', 'LOCKED') THEN
    -- already processed
    RETURN NEW;
  END IF;

  v_flags := COALESCE(NEW.anomaly_flags, '{}');

  -- get group + tolerance
  SELECT g.exchanger_id, g.tolerance_bps
    INTO v_exchanger_id, v_tolerance_bps
    FROM public.cf_machine_groups g
   WHERE g.id = NEW.group_id;

  -- coins dispensed by exchanger = diff of its coin meter in this session
  SELECT COALESCE(SUM(coin_meter_after - coin_meter_before), 0)
    INTO v_coins_out
    FROM public.cf_collection_events
   WHERE session_id = NEW.id
     AND machine_id = v_exchanger_id
     AND event_type = 'COLLECTION';

  -- coins received by claw machines · ONLY ตู้ใน group เดียวกัน
  -- (P0-5 fix: previously summed ALL claws in session regardless of group membership)
  SELECT COALESCE(SUM(e.coin_meter_after - e.coin_meter_before), 0),
         COUNT(*) FILTER (WHERE m.kind = 'CLAW')
    INTO v_coins_in, v_claw_count
    FROM public.cf_collection_events e
    JOIN public.cf_machines m ON m.id = e.machine_id
   WHERE e.session_id = NEW.id
     AND m.kind = 'CLAW'
     AND m.group_id = NEW.group_id
     AND e.event_type = 'COLLECTION';

  -- total cash collected this session (across all machines)
  SELECT COALESCE(SUM(cash_counted_cents), 0), COUNT(*)
    INTO v_total_cash, v_event_count
    FROM public.cf_collection_events
   WHERE session_id = NEW.id
     AND event_type = 'COLLECTION';

  -- G7: must have at least 1 event (not partial empty session)
  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'G7: Session has no events · cannot close';
  END IF;

  -- G2 hard BLOCK: exchanger dispensed coins but claws received 0
  IF v_coins_out > 0 AND v_coins_in = 0 AND v_claw_count > 0 THEN
    RAISE EXCEPTION 'G2: ตู้แลกแจก % เหรียญ แต่ตู้คีบรับ 0 (เป็นไปไม่ได้) · session %', v_coins_out, NEW.session_code;
  END IF;

  -- compute variance
  IF v_coins_out > 0 THEN
    v_variance_bps := ((v_coins_in - v_coins_out) * 10000 / v_coins_out);
  ELSE
    v_variance_bps := 0;
  END IF;

  -- G1: flag if |variance| > tolerance
  IF ABS(v_variance_bps) > v_tolerance_bps AND v_coins_out > 0 THEN
    v_flags := array_append(v_flags, 'COIN_GROUP_MISMATCH');
    NEW.status := 'ANOMALY_REVIEW';
  END IF;

  -- G3: claws received coins but exchanger dispensed 0
  IF v_coins_in > 0 AND v_coins_out = 0 THEN
    v_flags := array_append(v_flags, 'EXCHANGER_NO_DISPENSE');
  END IF;

  -- populate session cross-check fields
  NEW.exchanger_coins_out := v_coins_out;
  NEW.claw_coins_in       := v_coins_in;
  NEW.coin_variance_bps   := v_variance_bps;
  NEW.total_cash_cents    := v_total_cash;
  NEW.anomaly_flags       := v_flags;

  -- set closed_at if first time closing
  IF NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cf_session_close_crosscheck_trg ON public.cf_collection_sessions;
CREATE TRIGGER cf_session_close_crosscheck_trg
  BEFORE UPDATE ON public.cf_collection_sessions
  FOR EACH ROW EXECUTE FUNCTION public.cf_session_close_crosscheck();

-- ============================================================
-- 12. Generated columns (variance fields · readonly via Prisma)
-- ============================================================
-- Add computed columns to cf_collection_events for instant variance lookup
-- without recomputing in app layer.
ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS coins_delta INT
  GENERATED ALWAYS AS (coin_meter_after - coin_meter_before) STORED;

ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS dolls_delta INT
  GENERATED ALWAYS AS (COALESCE(doll_meter_after, 0) - COALESCE(doll_meter_before, 0)) STORED;

-- doll_variance = (stock_before + refill_qty - stock_after) - (doll_meter_after - doll_meter_before)
-- positive = สต๊อกหายมากกว่ามิเตอร์บอก (สงสัยขโมย)
ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS doll_variance INT
  GENERATED ALWAYS AS (
    (COALESCE(stock_before, 0) + COALESCE(refill_qty, 0) - COALESCE(stock_after, 0))
    - (COALESCE(doll_meter_after, 0) - COALESCE(doll_meter_before, 0))
  ) STORED;

-- ============================================================
-- 13. Additional partial indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS cf_sessions_anomaly_idx
  ON public.cf_collection_sessions (org_id, status, closed_at DESC)
  WHERE status = 'ANOMALY_REVIEW';

CREATE INDEX IF NOT EXISTS cf_events_photo_purge_idx
  ON public.cf_collection_events (created_at)
  WHERE photo_meter_before_url IS NOT NULL
    AND photos_purged_at IS NULL;

CREATE INDEX IF NOT EXISTS cf_machines_active_idx
  ON public.cf_machines (org_id, branch_id, kind)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS cf_loadouts_active_idx
  ON public.cf_machine_loadouts (machine_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS cf_exchanger_loadouts_active_idx
  ON public.cf_exchanger_loadouts (machine_id)
  WHERE effective_to IS NULL;

-- ============================================================
-- 14. Unique constraints — กัน race conditions
-- ============================================================
-- 1 OPEN session per group (already enforced by Prisma but kept for safety)
CREATE UNIQUE INDEX IF NOT EXISTS cf_sessions_one_open_per_group
  ON public.cf_collection_sessions (group_id)
  WHERE status = 'OPEN';

-- 1 COLLECTION event per (session, machine) — กัน 2 พนักงานกรอกตู้เดียวกันใน session เดียว
CREATE UNIQUE INDEX IF NOT EXISTS cf_events_one_collection_per_session_machine
  ON public.cf_collection_events (session_id, machine_id)
  WHERE event_type = 'COLLECTION';

-- 1 active loadout per machine (CLAW)
CREATE UNIQUE INDEX IF NOT EXISTS cf_loadouts_one_active_per_machine
  ON public.cf_machine_loadouts (machine_id)
  WHERE effective_to IS NULL;

-- 1 active exchanger loadout per machine
CREATE UNIQUE INDEX IF NOT EXISTS cf_exchanger_loadouts_one_active_per_machine
  ON public.cf_exchanger_loadouts (machine_id)
  WHERE effective_to IS NULL;

-- Composite index for trigger SUM lookup (P1-6 fix)
CREATE INDEX IF NOT EXISTS cf_events_session_machine_idx
  ON public.cf_collection_events (session_id, machine_id)
  WHERE event_type = 'COLLECTION';

-- ============================================================
-- 15. Seed default products (idempotent · per-org)
-- ============================================================
INSERT INTO public.cf_products (id, org_id, sku, name, category, default_price_coins, unit_cost_cents, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, p.sku, p.name, p.category::"CfProductCategory", p.default_price_coins, p.unit_cost_cents, true, NOW(), NOW()
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('PLUSH-BEAR',    'ตุ๊กตาหมี',         'PLUSH',       1, 4500),
    ('PLUSH-CAT',     'ตุ๊กตาแมว',         'PLUSH',       1, 4500),
    ('PLUSH-UNICORN', 'ตุ๊กตายูนิคอร์น',   'PLUSH',       1, 5500),
    ('TOY-MIX',       'ของเล่นรวม',        'TOY',         1, 3500),
    ('KEYCHAIN',      'พวงกุญแจ',          'KEYCHAIN',    1, 1500),
    ('SNACK-MIX',     'ขนมรวม',            'SNACK',       1, 2500),
    ('MYSTERY-BOX-S', 'กล่องสุ่ม S',       'MYSTERY_BOX', 2, 8000),
    ('MODEL-FIG',     'โมเดล',              'MODEL',       2, 12000)
) AS p(sku, name, category, default_price_coins, unit_cost_cents)
WHERE o.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.cf_products cp
    WHERE cp.org_id = o.id AND cp.sku = p.sku
  );

-- ============================================================
-- 16. Verification (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename LIKE 'cf_%';
--   -- all 8 should be rowsecurity=true
--
--   SELECT public.cf_next_session_code((SELECT id FROM organizations LIMIT 1));
--   -- e.g. "CFS-2569-000001"
--
--   SELECT count(*) FROM cf_products WHERE org_id = (SELECT id FROM organizations LIMIT 1);
--   -- 8 seeded products
--
--   -- Verify generated columns
--   SELECT column_name, generation_expression FROM information_schema.columns
--   WHERE table_name = 'cf_collection_events' AND is_generated = 'ALWAYS';
--   -- coins_delta, dolls_delta, doll_variance
