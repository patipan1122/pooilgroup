-- LedgerLine — member ↔ branch back-office (GAP 4, CEO 2026-06-05).
--
-- The "ใครดูแลสาขาไหน" feature: members appear in the web back-office (auto-seeded
-- from group activity OR via invite), an admin assigns/changes the branches each
-- oversees (ledger_line_member.scope_branch_ids — already exists), AND a member
-- can self-request ONE branch in LINE which lands here for admin approval.
--
-- This migration only adds the "pending request" column; everything else
-- (scope_branch_ids, role, display_name, active) already exists on the table.
-- Idempotent — safe to re-run.

ALTER TABLE public.ledger_line_member
  ADD COLUMN IF NOT EXISTS pending_branch_id uuid;

COMMENT ON COLUMN public.ledger_line_member.pending_branch_id IS
  'สาขาที่สมาชิกขอดูแล (รออนุมัติ) — แอดมินอนุมัติ → ย้ายเข้า scope_branch_ids แล้วเคลียร์';
