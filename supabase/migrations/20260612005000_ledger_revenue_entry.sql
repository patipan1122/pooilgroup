-- LedgerLine: Revenue entry table (book side for bank credit matching).
-- Stores income records from TRCloud IV, ChairOps, ClawFleet, FuelOS, manual entry,
-- and generic webhook sources. The auto-match engine joins bank CREDITS against these.
--
-- source_type values:
--   TRCLOUD_IV  — TRCloud Invoice (synced via API or push webhook)
--   CHAIROPS    — ChairOps maid-settle collection
--   CLAWFLEET   — ClawFleet claw-machine collection
--   FUELOS      — FuelOS pump sale
--   WEBHOOK     — generic inbound webhook (any external POS/system)
--   MANUAL      — manually entered by accountant

CREATE TABLE IF NOT EXISTS ledger_revenue_entry (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  company_id        UUID        NOT NULL,

  entry_date        DATE        NOT NULL,
  amount_satang     BIGINT      NOT NULL CHECK (amount_satang > 0), -- always positive
  source_type       VARCHAR(30) NOT NULL
    CHECK (source_type IN ('TRCLOUD_IV','CHAIROPS','CLAWFLEET','FUELOS','WEBHOOK','MANUAL')),
  source_ref        VARCHAR(100),       -- TRCloud doc_no / ChairOps session / external ref
  description       TEXT,
  customer_name     VARCHAR(200),
  payment_channel   VARCHAR(30),        -- cash / card / qr / transfer / mixed / other
  raw_json          JSONB,              -- original payload (PDPA: redact PII before insert)

  -- match state — tracks whether a bank credit has been reconciled against this entry
  match_state       VARCHAR(20) NOT NULL DEFAULT 'unmatched'
    CHECK (match_state IN ('unmatched','matched','excluded')),
  bank_txn_id       UUID        REFERENCES ledger_bank_txn(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup index: prevent double-import from the same external source
CREATE UNIQUE INDEX IF NOT EXISTS ledger_revenue_entry_source_uniq
  ON ledger_revenue_entry(org_id, company_id, source_type, source_ref)
  WHERE source_ref IS NOT NULL;

-- Query index for reconcile hub + auto-match window lookups
CREATE INDEX IF NOT EXISTS ledger_revenue_entry_date_idx
  ON ledger_revenue_entry(company_id, entry_date, match_state);

-- RLS
ALTER TABLE ledger_revenue_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_revenue_entry_org_policy"
  ON ledger_revenue_entry FOR ALL
  TO authenticated
  USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
  WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
