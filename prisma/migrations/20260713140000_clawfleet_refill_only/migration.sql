-- ClawFleet — "เปลี่ยนตุ๊กตาโดยไม่เก็บเงิน" (REFILL_ONLY event)
-- Option C-mirror: staff swaps dolls (−N return / +M refill) WITHOUT collecting cash / WITHOUT reading a meter.
-- The reconciliation baseline is CfMachine.last_doll_stock (updated ONLY by the AFTER-INSERT trigger).
-- A REFILL_ONLY event advances that mirror by ONLY the deliberate swap change (−N + M), freezing both meters,
-- so any clawing that happened before the swap is still captured at the NEXT real COLLECTION.
-- Additive only. No data touched.

-- 1) New event type. ALTER TYPE ADD VALUE — its own statement, idempotent.
--    Safe inside Prisma's per-migration transaction on PG12+: the new value is NOT USED as an enum
--    literal anywhere in this migration (the trigger below compares event_type to plain TEXT string
--    literals in an IN(...) list, which is a value comparison, not a DDL use of the enum member).
ALTER TYPE public."CfEventType" ADD VALUE IF NOT EXISTS 'REFILL_ONLY';

-- 2) Audit column — how many dolls were returned to stock (N) in the swap. Nullable (only set on REFILL_ONLY).
ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS dolls_returned_to_stock integer;

-- 3) Machine-mirror trigger — REFILL_ONLY must ALSO advance the mirror (last_doll_stock / meters).
--    Copied VERBATIM from supabase/migrations/20260521000002_clawfleet_module.sql:108-126,
--    only adding 'REFILL_ONLY' to the IN list. Every other line preserved:
--      - COALESCE guards (keep old value when NEW.* is NULL)
--      - the (last_event_at IS NULL OR NEW.collected_at > last_event_at) monotonic guard
--    For REFILL_ONLY the action layer FREEZES both meters (coin/doll before==after==current mirror),
--    so copying NEW.coin_meter_after / NEW.doll_meter_after here is a no-op on the meters — only
--    last_doll_stock advances (by −N+M). Getting the freeze wrong would reset the meter mirror.
CREATE OR REPLACE FUNCTION public.cf_update_machine_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update for INITIAL, COLLECTION, or REFILL_ONLY (not VOID)
  IF NEW.event_type IN ('INITIAL', 'COLLECTION', 'REFILL_ONLY') THEN
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

-- trigger binding unchanged (AFTER INSERT on cf_collection_events); function replaced in place.

-- 4) Idempotency backstop (P0-1) — DB-level guarantee that ONE clientKey (carried on the
--    refId of the REFILL_ONLY anchor movement) can produce AT MOST ONE swap, even if two
--    concurrent submits with the same clientKey both slip past the in-tx dup-check.
--    The action takes a per-clientKey advisory lock first (serialises the common case); this
--    partial unique index is the last-line guarantee. A colliding INSERT raises Postgres 23505
--    → Prisma P2002, which submitRefillOnly catches and turns into a no-op replay (returns the
--    already-created event). Partial (WHERE ref_table='cf_refill_only') so it constrains ONLY
--    refill-only anchor rows and never touches COLLECTION load rows (which reuse ref_id per event).
CREATE UNIQUE INDEX IF NOT EXISTS cf_stock_movements_refill_only_key
  ON public.cf_stock_movements (org_id, ref_table, ref_id)
  WHERE ref_table = 'cf_refill_only';
