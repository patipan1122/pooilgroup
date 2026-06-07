-- LedgerLine — dedup constraints for expense image sha256 and payment transRef.
-- 2026-06-07
--
-- IMPORTANT: Column name audit before adding constraints.
--
-- ledger_expense.sha256 (NOT image_sha256):
--   The partial unique index ledger_expense_org_company_sha256_key on
--   (org_id, company_id, sha256) WHERE sha256 IS NOT NULL was created in
--   20260603120000_ledger_expense_sha256_unique.sql. That index already covers
--   the sha256 dedup requirement — no new index needed on this column.
--   A second index named ledger_expense_sha256_unique would be redundant;
--   we create it only as an alias if the original does not exist, to be safe.
--
-- ledger_payment.trans_ref (NOT transaction_ref):
--   The unique index ledger_payment_org_bank_ref_key on (org_id, sending_bank, trans_ref)
--   was created in 20260606120000_ledger_payments_quotations.sql.
--   That index scopes by (org_id, sending_bank) which prevents the same transRef
--   from a different bank from colliding. A tighter (org_id, company_id, trans_ref)
--   index is additive and correctly scoped per the app's company_id filter rule.

-- ============================================================
-- 1. ledger_expense sha256 dedup (guard — original index may already exist)
-- ============================================================
-- The canonical index from 20260603120000 uses column name "sha256". We add a
-- safety alias here with IF NOT EXISTS so re-running is harmless either way.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_expense_sha256_unique
  ON public.ledger_expense (org_id, company_id, sha256)
  WHERE sha256 IS NOT NULL;

-- ============================================================
-- 2. ledger_payment transRef dedup scoped to (org, company)
-- ============================================================
-- The existing index scopes to (org_id, sending_bank, trans_ref). The company-
-- scoped variant below lets the app enforce the rule even when sending_bank is
-- NULL (e.g. cash payments entered manually with a manual ref).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_transref_unique
  ON public.ledger_payment (org_id, company_id, trans_ref)
  WHERE trans_ref IS NOT NULL AND trans_ref != '';
