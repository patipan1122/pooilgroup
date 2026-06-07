-- LedgerLine — performance indexes + FK for email-message→connection.
-- 2026-06-07
--
-- Column name corrections (verified against existing migrations):
--   ledger_expense.sha256          (NOT image_sha256)
--   ledger_payment.trans_ref       (NOT transaction_ref)
--   scope_branch_ids lives on      ledger_line_member (NOT ledger_permission)
--
-- All indexes use IF NOT EXISTS — safe to re-run.
-- The transref index here drops + replaces the one from migration 20260607120000
-- (same name, same definition — this consolidation is safe because IF NOT EXISTS
-- will skip creation if the index from the prior migration already exists;
-- the DROP is also guarded).

-- ============================================================
-- 1. ledger_expense — covering indexes for list + filter queries
-- ============================================================

-- Primary list: time-sorted by org+company (most dashboard queries)
CREATE INDEX IF NOT EXISTS idx_ledger_expense_created_at
  ON public.ledger_expense (org_id, company_id, created_at DESC);

-- Filter by payment_status (partial: only rows that have it set)
CREATE INDEX IF NOT EXISTS idx_ledger_expense_payment_status
  ON public.ledger_expense (org_id, company_id, payment_status)
  WHERE payment_status IS NOT NULL;

-- Full-text vendor search (simple dictionary = works for Thai vendor names,
-- which are typically short ASCII or transliterated)
CREATE INDEX IF NOT EXISTS idx_ledger_expense_vendor_gin
  ON public.ledger_expense
  USING gin (to_tsvector('simple', coalesce(vendor, '')));

-- ============================================================
-- 2. ledger_line_member — GIN index on scope_branch_ids
--    (scope_branch_ids is on ledger_line_member, not ledger_permission)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ledger_permission_scope_branches
  ON public.ledger_line_member
  USING gin (scope_branch_ids);

-- ============================================================
-- 3. ledger_email_message → ledger_email_connection FK
--    (connection_id exists on ledger_email_message from 20260606150000)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_ledger_email_message_connection'
  ) THEN
    ALTER TABLE public.ledger_email_message
      ADD CONSTRAINT fk_ledger_email_message_connection
      FOREIGN KEY (connection_id)
      REFERENCES public.ledger_email_connection (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 4. ledger_payment transRef — ensure (org, company, trans_ref) index exists
--    (The index from 20260607120000 may already be present; IF NOT EXISTS guards it)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_transref_unique
  ON public.ledger_payment (org_id, company_id, trans_ref)
  WHERE trans_ref IS NOT NULL AND trans_ref != '';
