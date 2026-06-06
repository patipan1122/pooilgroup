-- LedgerLine TRCloud v2: fixed SKU + VAT claimability per category
-- CEO approved 2026-06-06, confirmed by CFO review

ALTER TABLE ledger_category
  ADD COLUMN IF NOT EXISTS trcloud_product_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_claimable BOOLEAN NOT NULL DEFAULT FALSE;

-- Clear old LDG* SKU explosion cache (created by v1 search-before-create)
DELETE FROM ledger_trcloud_product;
