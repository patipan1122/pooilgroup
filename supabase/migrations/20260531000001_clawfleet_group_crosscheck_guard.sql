-- ClawFleet — fix cross-check trigger for mixed Type A (cash) / Type B (token) groups
-- 2026-05-31 · anti-fraud core
--
-- WHY: cf_session_close_crosscheck (migration 20260521000002) appends
-- EXCHANGER_NO_DISPENSE whenever claws received coins but no exchanger dispensed.
-- That is CORRECT for a TOKEN group, but a CASH group (Type A · no exchanger by
-- design) would be FALSE-flagged on every close. CEO 2026-05-31: cash + token
-- groups coexist in the same branch.
--
-- FIX: only run the exchanger/token cross-check when the group actually HAS an
-- exchanger (g.exchanger_id IS NOT NULL). Cash groups skip token checks entirely
-- and rely on the app-layer cash + doll cross-check.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + re-attach trigger. No data change.
-- Apply via psql (DIRECT_URL), NOT prisma db push.

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
  -- Only fire on transition OPEN → CLOSED / ANOMALY_REVIEW
  IF NEW.status NOT IN ('CLOSED', 'ANOMALY_REVIEW') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('CLOSED', 'ANOMALY_REVIEW', 'LOCKED') THEN
    RETURN NEW;  -- already processed
  END IF;

  v_flags := COALESCE(NEW.anomaly_flags, '{}');

  -- total cash + event count (across all machines in the session)
  SELECT COALESCE(SUM(cash_counted_cents), 0), COUNT(*)
    INTO v_total_cash, v_event_count
    FROM public.cf_collection_events
   WHERE session_id = NEW.id
     AND event_type = 'COLLECTION';

  -- G7: must have at least 1 event
  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'G7: Session has no events · cannot close';
  END IF;

  -- group + tolerance
  SELECT g.exchanger_id, g.tolerance_bps
    INTO v_exchanger_id, v_tolerance_bps
    FROM public.cf_machine_groups g
   WHERE g.id = NEW.group_id;

  -- TOKEN cross-check ONLY for groups that have an exchanger (Type B).
  -- Cash groups (Type A · no exchanger) + branch-flat sessions skip this block.
  IF v_exchanger_id IS NOT NULL THEN
    -- tokens dispensed by exchanger = its coin-meter delta this session
    SELECT COALESCE(SUM(coin_meter_after - coin_meter_before), 0)
      INTO v_coins_out
      FROM public.cf_collection_events
     WHERE session_id = NEW.id
       AND machine_id = v_exchanger_id
       AND event_type = 'COLLECTION';

    -- tokens received by CLAW machines IN THIS GROUP only
    SELECT COALESCE(SUM(e.coin_meter_after - e.coin_meter_before), 0),
           COUNT(*) FILTER (WHERE m.kind = 'CLAW')
      INTO v_coins_in, v_claw_count
      FROM public.cf_collection_events e
      JOIN public.cf_machines m ON m.id = e.machine_id
     WHERE e.session_id = NEW.id
       AND m.kind = 'CLAW'
       AND m.group_id = NEW.group_id
       AND e.event_type = 'COLLECTION';

    -- G2: exchanger dispensed tokens but claws received 0 — a strong fraud/tamper
    -- signal. Flag it for owner review instead of RAISE EXCEPTION: aborting the
    -- UPDATE would strand the round OPEN and the anomaly would never reach the
    -- review queue (the worst case must be the MOST visible, not a dead-end).
    IF v_coins_out > 0 AND v_coins_in = 0 AND v_claw_count > 0 THEN
      v_flags := array_append(v_flags, 'COIN_GROUP_MISMATCH');
      NEW.status := 'ANOMALY_REVIEW';
    END IF;

    -- variance
    IF v_coins_out > 0 THEN
      v_variance_bps := ((v_coins_in - v_coins_out) * 10000 / v_coins_out);
    ELSE
      v_variance_bps := 0;
    END IF;

    -- G1: token mismatch beyond tolerance → ทุจริต (แลก token นอกระบบ)
    IF ABS(v_variance_bps) > v_tolerance_bps AND v_coins_out > 0 THEN
      v_flags := array_append(v_flags, 'COIN_GROUP_MISMATCH');
      NEW.status := 'ANOMALY_REVIEW';
    END IF;

    -- G3: claws received tokens but exchanger dispensed 0 (exchanger meter issue)
    IF v_coins_in > 0 AND v_coins_out = 0 THEN
      v_flags := array_append(v_flags, 'EXCHANGER_NO_DISPENSE');
      NEW.status := 'ANOMALY_REVIEW';
    END IF;

    NEW.exchanger_coins_out := v_coins_out;
    NEW.claw_coins_in       := v_coins_in;
    NEW.coin_variance_bps   := v_variance_bps;
  END IF;

  NEW.total_cash_cents := v_total_cash;
  NEW.anomaly_flags    := v_flags;

  IF NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cf_session_close_crosscheck_trg ON public.cf_collection_sessions;
CREATE TRIGGER cf_session_close_crosscheck_trg
  BEFORE UPDATE ON public.cf_collection_sessions
  FOR EACH ROW EXECUTE FUNCTION public.cf_session_close_crosscheck();
