-- ============================================================
-- ChairOps RLS — apply AFTER `npx prisma db push` (or run by hand)
-- This migration assumes the chairops schema tables have been created
-- by Prisma with the Chairops* model names (see prisma/schema.prisma).
--
-- Per memory [[multi-tenant-rls]] + [[role-rank-privilege-escalation-guard]].
-- File renumbered to 9999_ to sort after Pool's existing 001-006 migrations.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS chairops;

-- Helper: get caller's chairops.User row (cached via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION chairops.current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.role::text FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.current_user_branch()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u."primaryBranchId"::uuid FROM chairops."ChairopsUser" u WHERE u."authUserId" = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION chairops.role_rank(r text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'MAID' THEN 1
    WHEN 'TECHNICIAN' THEN 1
    WHEN 'OFFICE' THEN 2
    WHEN 'MANAGER' THEN 3
    WHEN 'CEO' THEN 4
    WHEN 'ADMIN' THEN 5
    ELSE 0
  END
$$;

-- ============================================================
-- Enable RLS on every table
-- ============================================================

ALTER TABLE chairops."ChairopsBranch"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsUser"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsMaidAssignment"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsChair"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsPosImport"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsPosDaily"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsCashCollection"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsDrift"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsAlert"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsWriteOff"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsDamageTicket"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsSparePart"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsSparePartMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsCleanlinessReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsAuditLog"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsBankAccount"       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Branch — everyone sees all active branches (read)
-- Only ADMIN can write
-- ============================================================

CREATE POLICY branch_read ON chairops."ChairopsBranch" FOR SELECT
  USING (chairops.current_user_role() IS NOT NULL);
CREATE POLICY branch_write ON chairops."ChairopsBranch" FOR ALL
  USING (chairops.current_user_role() = 'ADMIN')
  WITH CHECK (chairops.current_user_role() = 'ADMIN');

-- ============================================================
-- User — admin sees all · everyone reads self
-- ============================================================

CREATE POLICY user_read_self_or_admin ON chairops."ChairopsUser" FOR SELECT
  USING (
    "authUserId" = auth.uid()::text
    OR chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
  );
CREATE POLICY user_write_admin ON chairops."ChairopsUser" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- MaidAssignment — office+ read all · admin write
-- ============================================================

CREATE POLICY maid_assignment_read ON chairops."ChairopsMaidAssignment" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY maid_assignment_write ON chairops."ChairopsMaidAssignment" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- Chair — read by all auth users · admin/manager write
-- ============================================================

CREATE POLICY chair_read ON chairops."ChairopsChair" FOR SELECT
  USING (chairops.current_user_role() IS NOT NULL);
CREATE POLICY chair_write ON chairops."ChairopsChair" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'));

-- ============================================================
-- PosImport · PosDaily — office+ all · MAID/TECHNICIAN none
-- ============================================================

CREATE POLICY pos_import_office_read ON chairops."ChairopsPosImport" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY pos_import_office_write ON chairops."ChairopsPosImport" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY pos_daily_office_read ON chairops."ChairopsPosDaily" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY pos_daily_office_write ON chairops."ChairopsPosDaily" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- CashCollection — MAID sees/writes own branch · OFFICE+ sees all · MAID can't edit after 30 min
-- ============================================================

CREATE POLICY cash_read_branch ON chairops."ChairopsCashCollection" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY cash_insert_branch ON chairops."ChairopsCashCollection" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY cash_update_office_only ON chairops."ChairopsCashCollection" FOR UPDATE
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Drift · Alert · WriteOff — office+ only
-- ============================================================

CREATE POLICY drift_office_all ON chairops."ChairopsDrift" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY alert_read ON chairops."ChairopsAlert" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY alert_write ON chairops."ChairopsAlert" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

CREATE POLICY writeoff_read ON chairops."ChairopsWriteOff" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY writeoff_write ON chairops."ChairopsWriteOff" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Damage Tickets — MAID/TECH branch-scope · OFFICE+ all
-- ============================================================

CREATE POLICY damage_read ON chairops."ChairopsDamageTicket" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
    OR "assignedToId" = chairops.current_user_id()
  );

CREATE POLICY damage_insert ON chairops."ChairopsDamageTicket" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );

CREATE POLICY damage_update_office_or_assignee ON chairops."ChairopsDamageTicket" FOR UPDATE
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "assignedToId" = chairops.current_user_id()
  )
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "assignedToId" = chairops.current_user_id()
  );

-- ============================================================
-- SparePart · SparePartMovement — office+ read · manager+ write
-- ============================================================

CREATE POLICY part_read ON chairops."ChairopsSparePart" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY part_write ON chairops."ChairopsSparePart" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('MANAGER'));

CREATE POLICY part_movement_read ON chairops."ChairopsSparePartMovement" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY part_movement_write ON chairops."ChairopsSparePartMovement" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- Cleanliness — MAID writes/reads own branch · OFFICE+ all
-- ============================================================

CREATE POLICY clean_read ON chairops."ChairopsCleanlinessReport" FOR SELECT
  USING (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );
CREATE POLICY clean_insert ON chairops."ChairopsCleanlinessReport" FOR INSERT
  WITH CHECK (
    chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE')
    OR "branchId" = chairops.current_user_branch()
  );
CREATE POLICY clean_update_office ON chairops."ChairopsCleanlinessReport" FOR UPDATE
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));

-- ============================================================
-- AuditLog — read by ADMIN/CEO only · INSERT by anyone (via writeAudit) · NO update/delete (immutable)
-- ============================================================

CREATE POLICY audit_read ON chairops."ChairopsAuditLog" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('CEO'));
CREATE POLICY audit_insert ON chairops."ChairopsAuditLog" FOR INSERT
  WITH CHECK (chairops.current_user_role() IS NOT NULL);
-- no UPDATE or DELETE policy = blocked

-- ============================================================
-- BankAccount — office+ read · admin write
-- ============================================================

CREATE POLICY bank_read ON chairops."ChairopsBankAccount" FOR SELECT
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('OFFICE'));
CREATE POLICY bank_write ON chairops."ChairopsBankAccount" FOR ALL
  USING (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'))
  WITH CHECK (chairops.role_rank(chairops.current_user_role()) >= chairops.role_rank('ADMIN'));

-- ============================================================
-- Sequence helper for damage ticket codes (CH-YYYY-NNNN)
-- ============================================================

CREATE OR REPLACE FUNCTION chairops.next_damage_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  buddhist_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int + 543;
  next_n int;
BEGIN
  SELECT COALESCE(MAX((REGEXP_MATCH(d."ticketCode", '^CH-' || buddhist_year || '-(\d+)$'))[1]::int), 0) + 1
  INTO next_n
  FROM chairops."ChairopsDamageTicket" d
  WHERE d."ticketCode" LIKE 'CH-' || buddhist_year || '-%';

  RETURN 'CH-' || buddhist_year || '-' || LPAD(next_n::text, 4, '0');
END;
$$;
