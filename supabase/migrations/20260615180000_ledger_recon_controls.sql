-- LedgerLine — Bank-Recon Controls & Workspace (bigfeature 2026-06-15)
-- Adds: cross-account internal transfers, reversed-group snapshot (searchable archive),
--       approval-to-revert-confirmed workflow. Migration-before-code.
-- Safe/additive: existing groups default match_type='standard' (keep bank_account_id NOT NULL value),
--   so chk_transfer_acct passes for all existing rows.

-- ── (A) Transfer support on the N:M group model ───────────────────────────────
-- A โยกเงิน (internal transfer) pairs a debit on account A with a credit on account B.
-- Account identity lives per-leg (ledger_bank_txn.bank_account_id), so a transfer group
-- has bank_account_id = NULL (it spans accounts); standard groups keep their single account.
ALTER TABLE public.ledger_bank_match_group ALTER COLUMN bank_account_id DROP NOT NULL;

ALTER TABLE public.ledger_bank_match_group
  ADD COLUMN IF NOT EXISTS match_type varchar(20) NOT NULL DEFAULT 'standard';

ALTER TABLE public.ledger_bank_match_group
  DROP CONSTRAINT IF EXISTS chk_group_match_type;
ALTER TABLE public.ledger_bank_match_group
  ADD CONSTRAINT chk_group_match_type CHECK (match_type IN ('standard','transfer'));

-- integrity: transfer ⇒ NULL group account · standard ⇒ has account
ALTER TABLE public.ledger_bank_match_group
  DROP CONSTRAINT IF EXISTS chk_transfer_acct;
ALTER TABLE public.ledger_bank_match_group
  ADD CONSTRAINT chk_transfer_acct CHECK (
    (match_type = 'transfer' AND bank_account_id IS NULL)
    OR (match_type = 'standard' AND bank_account_id IS NOT NULL)
  );

-- fast cross-account listing for the special-items hub (#7)
CREATE INDEX IF NOT EXISTS ledger_bank_match_group_transfer_idx
  ON public.ledger_bank_match_group (org_id, company_id, status)
  WHERE match_type = 'transfer';

-- ── (B) Reversed-group snapshot (searchable matched archive #2) ────────────────
-- removeGroup/revert DELETEs the match_items, so a reversed group would lose "what it
-- matched". Snapshot the items+totals into jsonb BEFORE delete so the archive can show it.
ALTER TABLE public.ledger_bank_match_group
  ADD COLUMN IF NOT EXISTS reversed_snapshot jsonb;

-- ── (C) Approval-to-revert-confirmed (#3) ─────────────────────────────────────
-- Non-super_admin who wants to revert a CONFIRMED (posted) match files a request;
-- super_admin approves → revert executes. Mirrors RecruitErasureRequest + ChairopsWriteOff maker/checker.
CREATE TABLE IF NOT EXISTS public.ledger_recon_edit_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  target_group_id uuid NOT NULL REFERENCES public.ledger_bank_match_group(id) ON DELETE CASCADE,
  action          varchar(20) NOT NULL DEFAULT 'revert' CHECK (action IN ('revert')),
  reason          text NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by    uuid NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  snapshot_json   jsonb,   -- group summary at request time (evidence for the approver)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_recon_edit_request_org_status_idx
  ON public.ledger_recon_edit_request (org_id, company_id, status);
-- idempotency: no duplicate pending request for the same group (a non-super mashing the button)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_recon_edit_request_one_pending_uniq
  ON public.ledger_recon_edit_request (target_group_id) WHERE status = 'PENDING';

ALTER TABLE public.ledger_recon_edit_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_recon_edit_request_org_policy ON public.ledger_recon_edit_request
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
