-- LedgerLine — Bank Reconciliation, Table 3/6: ledger_bank_txn
-- The immutable "bank plane" — one row per bank statement line.
-- NEVER updated after insert (immutable audit evidence for CPA).
--
-- line_hash = sha256(accountNo|txnDate|amountSatang|balanceSatang|ref1|batchId|rowIndex)
-- rowIndex is needed because KBank/SCB standing orders have identical amounts
-- on the same day — pure content hash would deduplicate legitimate entries.

CREATE TABLE IF NOT EXISTS public.ledger_bank_txn (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  company_id        uuid NOT NULL,
  bank_account_id   uuid NOT NULL REFERENCES public.ledger_bank_account(id) ON DELETE RESTRICT,
  batch_id          uuid NOT NULL REFERENCES public.ledger_bank_import_batch(id) ON DELETE RESTRICT,
  -- dedup key: immutable once inserted
  line_hash         varchar(64)  NOT NULL,
  -- transaction data
  txn_date          date         NOT NULL,
  value_date        date         DEFAULT NULL,
  -- amounts in satang (×100) to avoid floating-point issues. D/C split from raw columns.
  amount_satang     bigint       NOT NULL,  -- positive = credit (deposit), negative = debit (withdrawal)
  balance_satang    bigint       NOT NULL,  -- running balance after this transaction
  ref1              varchar(200) DEFAULT NULL,
  ref2              varchar(200) DEFAULT NULL,
  description       text         DEFAULT NULL,
  channel           varchar(100) DEFAULT NULL,  -- 'Mobile', 'KBANK', 'EDC/K SHOP/MYQR', etc.
  -- match state: 'unmatched' | 'suggested' | 'confirmed' | 'excluded'
  match_state       varchar(20)  NOT NULL DEFAULT 'unmatched',
  -- source: 'CSV' | 'EXCEL' | 'MANUAL_BAAC'
  source_type       varchar(20)  NOT NULL DEFAULT 'CSV',
  row_index         int          NOT NULL DEFAULT 0,
  raw_row_json      jsonb        DEFAULT NULL, -- D12: full raw row for re-derivation
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_match_state CHECK (match_state IN ('unmatched','suggested','confirmed','excluded')),
  CONSTRAINT chk_source_type CHECK (source_type IN ('CSV','EXCEL','MANUAL_BAAC'))
);

-- UNIQUE: one entry per (account, content-hash) — prevents double-import
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_txn_acct_hash_uidx
  ON public.ledger_bank_txn (bank_account_id, line_hash);

CREATE INDEX IF NOT EXISTS ledger_bank_txn_org_co_date_idx
  ON public.ledger_bank_txn (org_id, company_id, txn_date);

CREATE INDEX IF NOT EXISTS ledger_bank_txn_batch_idx
  ON public.ledger_bank_txn (batch_id);

CREATE INDEX IF NOT EXISTS ledger_bank_txn_match_state_idx
  ON public.ledger_bank_txn (org_id, company_id, match_state);

ALTER TABLE public.ledger_bank_txn ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_txn_org_policy ON public.ledger_bank_txn
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));

-- ============================================================
-- Atomic batch insert RPC (D9: Supabase-compatible atomic import)
-- Takes: p_batch jsonb (batch header row), p_txns jsonb[] (transaction rows)
-- Returns: inserted_count, skipped_count
-- ============================================================
CREATE OR REPLACE FUNCTION public.ledger_bank_insert_batch(
  p_batch jsonb,
  p_txns  jsonb[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_id    uuid;
  v_inserted    int := 0;
  v_skipped     int := 0;
  v_txn         jsonb;
BEGIN
  -- 1. Insert or get batch header
  INSERT INTO public.ledger_bank_import_batch (
    id, org_id, company_id, bank_account_id,
    period_start, period_end, batch_format_version, source_filename,
    row_count, status, uploaded_by
  ) VALUES (
    (p_batch->>'id')::uuid,
    (p_batch->>'org_id')::uuid,
    (p_batch->>'company_id')::uuid,
    (p_batch->>'bank_account_id')::uuid,
    (p_batch->>'period_start')::date,
    (p_batch->>'period_end')::date,
    p_batch->>'batch_format_version',
    p_batch->>'source_filename',
    (p_batch->>'row_count')::int,
    'imported',
    (p_batch->>'uploaded_by')::uuid
  )
  RETURNING id INTO v_batch_id;

  -- 2. Insert transactions (ON CONFLICT DO NOTHING = idempotent re-import)
  FOREACH v_txn IN ARRAY p_txns LOOP
    INSERT INTO public.ledger_bank_txn (
      id, org_id, company_id, bank_account_id, batch_id,
      line_hash, txn_date, value_date,
      amount_satang, balance_satang,
      ref1, ref2, description, channel,
      source_type, row_index, raw_row_json
    ) VALUES (
      gen_random_uuid(),
      (v_txn->>'org_id')::uuid,
      (v_txn->>'company_id')::uuid,
      (v_txn->>'bank_account_id')::uuid,
      v_batch_id,
      v_txn->>'line_hash',
      (v_txn->>'txn_date')::date,
      CASE WHEN v_txn->>'value_date' IS NOT NULL THEN (v_txn->>'value_date')::date ELSE NULL END,
      (v_txn->>'amount_satang')::bigint,
      (v_txn->>'balance_satang')::bigint,
      v_txn->>'ref1',
      v_txn->>'ref2',
      v_txn->>'description',
      v_txn->>'channel',
      COALESCE(v_txn->>'source_type', 'CSV'),
      COALESCE((v_txn->>'row_index')::int, 0),
      v_txn->'raw_row_json'
    )
    ON CONFLICT (bank_account_id, line_hash) DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 3. Update batch counts
  UPDATE public.ledger_bank_import_batch
  SET inserted_count = v_inserted,
      skipped_count  = v_skipped,
      updated_at     = now()
  WHERE id = v_batch_id;

  RETURN jsonb_build_object('batch_id', v_batch_id, 'inserted', v_inserted, 'skipped', v_skipped);
END;
$$;
