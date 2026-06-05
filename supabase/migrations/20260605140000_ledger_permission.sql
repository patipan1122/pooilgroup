-- LedgerLine — money-capability permission matrix (LIFF Admin Console, GAP 5).
--
-- CEO 2026-06-05: 4 roles (staff/accountant/admin/external_accountant) × a SMALL
-- set of money-risk capabilities the admin can toggle per role. This is NOT a full
-- Bainy matrix (over-build for a <20-person internal tool) — only the 5 toggles
-- that actually move money / leak P&L are stored; everything else stays open.
--
-- The table holds OVERRIDES only; a missing (org, role, capability) row falls back
-- to the code DEFAULTS in lib/ledger/permissions.ts. So no per-org seeding needed.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.ledger_permission (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  role        text NOT NULL,        -- staff | accountant | admin | external_accountant
  capability  text NOT NULL,        -- expense.confirm | expense.export | report.view_pnl | scope.all_branches | expense.edit_others
  allowed     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT ledger_permission_org_role_capability_key UNIQUE (org_id, role, capability)
);

CREATE INDEX IF NOT EXISTS ledger_permission_org_idx
  ON public.ledger_permission (org_id);

COMMENT ON TABLE public.ledger_permission IS
  'LedgerLine per-role money-capability overrides (LIFF admin "สิทธิ์" tab). Missing row = code default.';
