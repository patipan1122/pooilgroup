-- LedgerLine — หลายกลุ่ม LINE → หลายสาขา (B3 · multi-group → multi-branch).
--
-- One LINE OA can serve many branch groups, each group pinned to its OWN branch.
-- The webhook resolves an incoming group → branch via this table; when there's
-- NO row for a group it falls back to ledger_line_channel.branch_id — so existing
-- single-group setups behave EXACTLY as before (this migration is purely additive
-- and cannot alter or corrupt any existing row).
--
-- Rows self-register when an admin types "/setting สาขา <สาขา>" inside a branch
-- group; the web settings page (GroupBranchManager) lets an admin view/re-point/
-- pause them. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.ledger_line_group (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  group_id    text        NOT NULL,
  branch_id   uuid,
  label       text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One binding per (org, company, LINE group).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_line_group_org_company_group_key
  ON public.ledger_line_group (org_id, company_id, group_id);

-- Webhook + back-office lookups.
CREATE INDEX IF NOT EXISTS ledger_line_group_org_company_active_idx
  ON public.ledger_line_group (org_id, company_id, active);

COMMENT ON TABLE public.ledger_line_group IS
  'B3: maps a LINE group → its branch (one OA, many branch groups). No row = fall back to ledger_line_channel.branch_id.';
