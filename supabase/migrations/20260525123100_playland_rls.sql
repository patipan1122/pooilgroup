-- Playland module · Row Level Security
-- Applies after 20260525123000_playland_schema.sql creates the tables
-- All Playland tables are scoped to org_id via current_org_id() JWT claim
--
-- Reads: any user with valid JWT + same org_id
-- Writes: same · plus super_admin escape hatch via is_super_admin()
--
-- Per memory module-entitlement-must-gate-all-layouts: app-level entitlement
-- (userHasModuleAccess) is the FIRST defense · RLS is the LAST defense

-- =============================================================
-- 1. Enable RLS on all 19 playland tables
-- =============================================================
ALTER TABLE playland.branches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.devices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.family_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.family_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.packages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.face_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.sale_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.promos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.loyalty          ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.loyalty_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.waivers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.shifts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.daily_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.face_sync        ENABLE ROW LEVEL SECURITY;
ALTER TABLE playland.audit_logs       ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. Org-scoped policy generator (DRY)
-- =============================================================
-- branches
DROP POLICY IF EXISTS "playland_branches_isolation" ON playland.branches;
CREATE POLICY "playland_branches_isolation" ON playland.branches FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- devices
DROP POLICY IF EXISTS "playland_devices_isolation" ON playland.devices;
CREATE POLICY "playland_devices_isolation" ON playland.devices FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- family_groups
DROP POLICY IF EXISTS "playland_family_groups_isolation" ON playland.family_groups;
CREATE POLICY "playland_family_groups_isolation" ON playland.family_groups FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- family_members
DROP POLICY IF EXISTS "playland_family_members_isolation" ON playland.family_members;
CREATE POLICY "playland_family_members_isolation" ON playland.family_members FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- members
DROP POLICY IF EXISTS "playland_members_isolation" ON playland.members;
CREATE POLICY "playland_members_isolation" ON playland.members FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- packages
DROP POLICY IF EXISTS "playland_packages_isolation" ON playland.packages;
CREATE POLICY "playland_packages_isolation" ON playland.packages FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- sessions
DROP POLICY IF EXISTS "playland_sessions_isolation" ON playland.sessions;
CREATE POLICY "playland_sessions_isolation" ON playland.sessions FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- face_events — webhook insert needs special policy (no JWT context)
-- Solution: webhook route uses service_role client which bypasses RLS
DROP POLICY IF EXISTS "playland_face_events_isolation" ON playland.face_events;
CREATE POLICY "playland_face_events_isolation" ON playland.face_events FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- bookings — public form creates these via service_role client
DROP POLICY IF EXISTS "playland_bookings_isolation" ON playland.bookings;
CREATE POLICY "playland_bookings_isolation" ON playland.bookings FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- products
DROP POLICY IF EXISTS "playland_products_isolation" ON playland.products;
CREATE POLICY "playland_products_isolation" ON playland.products FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- sales
DROP POLICY IF EXISTS "playland_sales_isolation" ON playland.sales;
CREATE POLICY "playland_sales_isolation" ON playland.sales FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- sale_lines
DROP POLICY IF EXISTS "playland_sale_lines_isolation" ON playland.sale_lines;
CREATE POLICY "playland_sale_lines_isolation" ON playland.sale_lines FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- promos
DROP POLICY IF EXISTS "playland_promos_isolation" ON playland.promos;
CREATE POLICY "playland_promos_isolation" ON playland.promos FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- loyalty
DROP POLICY IF EXISTS "playland_loyalty_isolation" ON playland.loyalty;
CREATE POLICY "playland_loyalty_isolation" ON playland.loyalty FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- loyalty_ledger
DROP POLICY IF EXISTS "playland_loyalty_ledger_isolation" ON playland.loyalty_ledger;
CREATE POLICY "playland_loyalty_ledger_isolation" ON playland.loyalty_ledger FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- waivers
DROP POLICY IF EXISTS "playland_waivers_isolation" ON playland.waivers;
CREATE POLICY "playland_waivers_isolation" ON playland.waivers FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- alerts
DROP POLICY IF EXISTS "playland_alerts_isolation" ON playland.alerts;
CREATE POLICY "playland_alerts_isolation" ON playland.alerts FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- shifts
DROP POLICY IF EXISTS "playland_shifts_isolation" ON playland.shifts;
CREATE POLICY "playland_shifts_isolation" ON playland.shifts FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- daily_reports
DROP POLICY IF EXISTS "playland_daily_reports_isolation" ON playland.daily_reports;
CREATE POLICY "playland_daily_reports_isolation" ON playland.daily_reports FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- face_sync
DROP POLICY IF EXISTS "playland_face_sync_isolation" ON playland.face_sync;
CREATE POLICY "playland_face_sync_isolation" ON playland.face_sync FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- audit_logs — immutable: no UPDATE/DELETE for non-super_admin
DROP POLICY IF EXISTS "playland_audit_logs_read" ON playland.audit_logs;
CREATE POLICY "playland_audit_logs_read" ON playland.audit_logs FOR SELECT
  USING (org_id = public.current_org_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "playland_audit_logs_insert" ON playland.audit_logs;
CREATE POLICY "playland_audit_logs_insert" ON playland.audit_logs FOR INSERT
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- (No UPDATE or DELETE policy — audit logs are immutable except for super_admin via service_role)

-- =============================================================
-- 3. Helper RPCs (plpgsql)
-- =============================================================

-- Compute remaining seconds for a session, accounting for paused time
CREATE OR REPLACE FUNCTION playland.session_remaining_seconds(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = playland, public
AS $$
DECLARE
  s record;
  elapsed_secs int;
  remaining int;
BEGIN
  SELECT * INTO s FROM playland.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Day pass = unlimited
  IF s.package_minutes = 0 THEN RETURN 999999; END IF;

  -- If currently paused, count time up to paused_at
  IF s.status = 'PAUSED' AND s.paused_at IS NOT NULL THEN
    elapsed_secs := EXTRACT(EPOCH FROM (s.paused_at - s.check_in_at))::int - s.total_paused_seconds;
  ELSIF s.status = 'ACTIVE' THEN
    elapsed_secs := EXTRACT(EPOCH FROM (now() - s.check_in_at))::int - s.total_paused_seconds;
  ELSE
    RETURN 0;  -- COMPLETED/EXPIRED/FORFEITED
  END IF;

  remaining := (s.package_minutes * 60) - elapsed_secs;
  IF remaining < 0 THEN RETURN 0; END IF;
  RETURN remaining;
END;
$$;

COMMENT ON FUNCTION playland.session_remaining_seconds(uuid) IS
  'Returns seconds remaining for a session. 999999 for day pass. 0 for completed/expired.';

-- Mark expired sessions + create alerts (cron-triggered)
CREATE OR REPLACE FUNCTION playland.expire_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = playland, public
AS $$
DECLARE
  s record;
  expired_count int := 0;
BEGIN
  -- ACTIVE sessions whose time is up
  FOR s IN
    SELECT * FROM playland.sessions
    WHERE status = 'ACTIVE'
      AND package_minutes > 0
      AND (check_in_at + (package_minutes || ' minutes')::interval + (total_paused_seconds || ' seconds')::interval) < now()
  LOOP
    UPDATE playland.sessions SET status = 'EXPIRED', expires_at = now() WHERE id = s.id;
    INSERT INTO playland.alerts (id, org_id, branch_id, session_id, type, severity, title, message, created_at)
    VALUES (gen_random_uuid(), s.org_id, s.branch_id, s.id, 'TIME_EXPIRED', 'WARNING',
            'หมดเวลาเล่น', 'session ' || s.id || ' หมดเวลา', now());
    expired_count := expired_count + 1;
  END LOOP;

  -- PAUSED sessions whose re-entry deadline passed
  FOR s IN
    SELECT * FROM playland.sessions
    WHERE status = 'PAUSED'
      AND reentry_deadline_at IS NOT NULL
      AND reentry_deadline_at < now()
  LOOP
    UPDATE playland.sessions SET status = 'FORFEITED', check_out_at = now() WHERE id = s.id;
    INSERT INTO playland.alerts (id, org_id, branch_id, session_id, type, severity, title, message, created_at)
    VALUES (gen_random_uuid(), s.org_id, s.branch_id, s.id, 'REENTRY_EXPIRED', 'DANGER',
            'ขาดสิทธิ์เพราะกลับมาเกิน 15 นาที', 'session ' || s.id || ' forfeited', now());
    expired_count := expired_count + 1;
  END LOOP;

  RETURN expired_count;
END;
$$;

COMMENT ON FUNCTION playland.expire_sessions() IS
  'Cron-triggered: marks expired/forfeited sessions + creates alerts. Returns count handled.';

-- Compute pending face sync count per device
CREATE OR REPLACE FUNCTION playland.face_sync_pending_count(p_device_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = playland, public
AS $$
  SELECT COUNT(*)::int FROM playland.face_sync
  WHERE device_id = p_device_id
    AND status IN ('PENDING', 'FAILED', 'DELETE_PENDING');
$$;

-- =============================================================
-- 4. Verification (run manually after apply)
-- =============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='playland';   -- all should be t (true)
--
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='playland';   -- should list 3 functions
