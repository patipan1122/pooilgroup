-- LedgerLine TRCloud v2: fixed SKU + VAT claimability per category
-- CEO approved 2026-06-06, confirmed by CFO review

ALTER TABLE ledger_category
  ADD COLUMN IF NOT EXISTS trcloud_product_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_claimable BOOLEAN NOT NULL DEFAULT FALSE;

-- Clear old LDG* SKU explosion cache (created by v1 search-before-create)
DELETE FROM ledger_trcloud_product;

-- Index for "not-yet-pushed confirmed" filter in listExpenses (upspeed)
CREATE INDEX idx_ledger_expense_trcloud_doc_id
  ON ledger_expense (org_id, company_id, trcloud_doc_id);
