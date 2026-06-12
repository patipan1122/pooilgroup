-- LedgerLine Bank Recon — audit P0/P1 fixes (2026-06-12)
-- From docs/AUDIT_bank-recon_2026-06-12.md
--
-- 1. matched_revenue_id — stop overloading matched_payment_id to hold revenue ids.
--    Credit matches now point at ledger_revenue_entry properly (enables write-back).
-- 2. reversal audit fields — record who/when/why a match was reversed (AUD-02).
-- 3. extend chk_match_type to allow no breakage (already covers needed values).

ALTER TABLE public.ledger_bank_match
  ADD COLUMN IF NOT EXISTS matched_revenue_id uuid DEFAULT NULL;

ALTER TABLE public.ledger_bank_match
  ADD COLUMN IF NOT EXISTS reversed_by    uuid        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reversed_at    timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exclusion_reason text      DEFAULT NULL;

CREATE INDEX IF NOT EXISTS ledger_bank_match_revenue_idx
  ON public.ledger_bank_match (matched_revenue_id)
  WHERE matched_revenue_id IS NOT NULL;

-- A payment/expense/revenue should not be claimed by two ACTIVE matches.
-- Partial unique guards prevent the same book entry being double-matched.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_revenue_active_uidx
  ON public.ledger_bank_match (matched_revenue_id)
  WHERE matched_revenue_id IS NOT NULL AND status IN ('suggested','confirmed');

CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_payment_active_uidx
  ON public.ledger_bank_match (matched_payment_id)
  WHERE matched_payment_id IS NOT NULL AND status IN ('suggested','confirmed');
