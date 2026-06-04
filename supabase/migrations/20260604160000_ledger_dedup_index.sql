-- LedgerLine — index for the cheap "จด" amount-dedup lookup.
-- 2026-06-04 · findRecentAmountDuplicate() filters (org_id, company_id, total,
-- created_at >= yesterday) on every text/photo capture. Add a covering index so
-- it stays O(log n) as the table grows. Idempotent.

CREATE INDEX IF NOT EXISTS ledger_expense_dedup_amount_idx
  ON public.ledger_expense (org_id, company_id, total, created_at DESC);
