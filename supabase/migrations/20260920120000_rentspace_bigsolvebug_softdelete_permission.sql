-- RentSpace bigsolvebug follow-up to /auditbigteam 2026-09-20 (docs/AUDIT_RentSpace_2026-09-20.md §5 Cluster A/B)
-- CEO-approved fixes:
--   1) deleting a PAID bill now requires a super_admin-approved request (mirrors
--      rental_bill.void_status maker≠checker shape) instead of being disallowed
--      outright or silently allowed (was previously allowed with zero guard — P0).
--   2) rental_bill/rental_payment/rental_discount move from hard-delete to
--      soft-delete (deleted_at) so financial records stay recoverable and the
--      org's own >=5yr audit-retention rule is respected (was hard-deleted — P0).
--   3) new rentspace_permission table — same sparse-override shape as
--      ledger_permission — backs a super_admin settings page that toggles which
--      role can do which sensitive RentSpace action (CEO-requested feature).
--
-- Purely additive (new nullable columns + one new table) — safe to apply ahead
-- of the code that uses them, per this repo's established rollback stance
-- (docs/RUNBOOK_rentspace_deploy.md: "tables additive, safe to leave").
-- Idempotent — safe to re-run.

ALTER TABLE public.rental_bill
  ADD COLUMN IF NOT EXISTS delete_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS delete_requested_by uuid,
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_decided_by uuid,
  ADD COLUMN IF NOT EXISTS delete_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_decision_note text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_note text;

CREATE INDEX IF NOT EXISTS rental_bill_org_id_deleted_at_idx
  ON public.rental_bill (org_id, deleted_at);

ALTER TABLE public.rental_payment
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_note text;

CREATE INDEX IF NOT EXISTS rental_payment_org_id_deleted_at_idx
  ON public.rental_payment (org_id, deleted_at);

ALTER TABLE public.rental_discount
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_note text;

CREATE INDEX IF NOT EXISTS rental_discount_org_id_deleted_at_idx
  ON public.rental_discount (org_id, deleted_at);

CREATE TABLE IF NOT EXISTS public.rentspace_permission (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  role        text NOT NULL,
  capability  text NOT NULL,
  allowed     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  UNIQUE (org_id, role, capability)
);

CREATE INDEX IF NOT EXISTS rentspace_permission_org_id_idx
  ON public.rentspace_permission (org_id);

COMMENT ON COLUMN public.rental_bill.delete_status IS
  'none | pending | approved | rejected — request to delete a PAID bill; only super_admin may decide (see actDecideDeleteBill). Unpaid bills bypass this and delete directly.';
COMMENT ON COLUMN public.rental_bill.deleted_at IS
  'Soft-delete timestamp. NULL = active. Every read query MUST filter deleted_at IS NULL — no DB-level auto-filter exists in this codebase (manual convention, see lib/prisma.ts).';
COMMENT ON TABLE public.rentspace_permission IS
  'Sparse permission override per (org, role, capability) for RentSpace. Missing row = use code-level default in lib/rentspace/permission-constants.ts. Mirrors ledger_permission.';
