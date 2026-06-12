-- LedgerLine — Bank Reconciliation, Table 2/6: ledger_bank_import_batch
-- One batch = one file upload / one manual entry session.
-- Period lock lives here (D13: simpler, no separate table needed).

CREATE TABLE IF NOT EXISTS public.ledger_bank_import_batch (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  company_id            uuid NOT NULL,
  bank_account_id       uuid NOT NULL REFERENCES public.ledger_bank_account(id) ON DELETE RESTRICT,
  -- period
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  -- metadata from file
  batch_format_version  varchar(30) DEFAULT NULL,  -- e.g. 'KBANK_KBIZ_v1', 'TTB_CSV_v1', 'MANUAL_BAAC'
  source_filename       varchar(255) DEFAULT NULL,
  -- import statistics
  row_count             int NOT NULL DEFAULT 0,
  inserted_count        int NOT NULL DEFAULT 0,
  skipped_count         int NOT NULL DEFAULT 0,   -- ON CONFLICT DO NOTHING (re-import)
  -- status: 'pending' | 'imported' | 'matched' | 'locked' | 'error'
  status                varchar(20) NOT NULL DEFAULT 'pending',
  conflict_log          jsonb DEFAULT NULL,  -- details of any duplicate rows skipped
  -- period lock (D13, CPA-only)
  locked_at             timestamptz DEFAULT NULL,
  locked_by             uuid DEFAULT NULL,     -- pool user id
  lock_fingerprint      varchar(64) DEFAULT NULL, -- SHA-256 of all txn line_hashes in batch
  -- audit
  uploaded_by           uuid DEFAULT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_bank_import_batch_org_co_acct_idx
  ON public.ledger_bank_import_batch (org_id, company_id, bank_account_id);

CREATE INDEX IF NOT EXISTS ledger_bank_import_batch_period_idx
  ON public.ledger_bank_import_batch (org_id, company_id, period_start, period_end);

ALTER TABLE public.ledger_bank_import_batch ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_import_batch_org_policy ON public.ledger_bank_import_batch
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
