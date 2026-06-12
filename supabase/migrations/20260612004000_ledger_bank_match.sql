-- LedgerLine — Bank Reconciliation, Table 4/6: ledger_bank_match + provisional_gl
-- The mutable "match plane" — junction between bank transactions and book entries.

-- ============================================================
-- 1. ledger_bank_match — mutable matching junction
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_bank_match (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL,
  company_id                  uuid NOT NULL,
  bank_txn_id                 uuid NOT NULL REFERENCES public.ledger_bank_txn(id) ON DELETE RESTRICT,
  -- one of these will be non-null (which book entry it matches)
  matched_expense_id          uuid DEFAULT NULL,
  matched_payment_request_id  uuid DEFAULT NULL,
  matched_payment_id          uuid DEFAULT NULL,
  -- match metadata
  match_type    varchar(30)  NOT NULL DEFAULT 'manual',
  -- 'manual' | 'auto_amount' | 'auto_ref' | 'auto_amount_date' | 'mdr_split' | 'exclusion'
  confidence    varchar(10)  NOT NULL DEFAULT 'medium',
  -- 'high' (exact amount+date) | 'medium' (amount within range) | 'low'
  -- financials (in satang)
  amount_satang               bigint NOT NULL,
  delta_satang                bigint NOT NULL DEFAULT 0,  -- bank_amount - book_amount
  -- status: 'suggested' | 'confirmed' | 'reversed'
  status                      varchar(20) NOT NULL DEFAULT 'suggested',
  -- who and when
  matched_by                  uuid DEFAULT NULL,
  matched_at                  timestamptz DEFAULT NULL,
  confirmed_by                uuid DEFAULT NULL,
  confirmed_at                timestamptz DEFAULT NULL,
  note                        text DEFAULT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_match_type CHECK (
    match_type IN ('manual','auto_amount','auto_ref','auto_amount_date','mdr_split','exclusion')
  ),
  CONSTRAINT chk_confidence CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT chk_status CHECK (status IN ('suggested','confirmed','reversed'))
);

-- One bank_txn can only have one ACTIVE confirmed match (prevents double-match)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_txn_confirmed_uidx
  ON public.ledger_bank_match (bank_txn_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS ledger_bank_match_org_co_idx
  ON public.ledger_bank_match (org_id, company_id);

CREATE INDEX IF NOT EXISTS ledger_bank_match_txn_idx
  ON public.ledger_bank_match (bank_txn_id);

CREATE INDEX IF NOT EXISTS ledger_bank_match_expense_idx
  ON public.ledger_bank_match (matched_expense_id)
  WHERE matched_expense_id IS NOT NULL;

ALTER TABLE public.ledger_bank_match ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_match_org_policy ON public.ledger_bank_match
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));

-- ============================================================
-- 2. ledger_bank_provisional_gl — unmatched credits need a GL entry (Thai GAAP D14)
-- Accountant reclassifies from 4999-PROV later.
-- This is the first local GL table in LedgerLine.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_bank_provisional_gl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  bank_txn_id     uuid NOT NULL REFERENCES public.ledger_bank_txn(id) ON DELETE RESTRICT,
  -- period e.g. '2026-06'
  period          char(7) NOT NULL,
  gl_account_code varchar(20) NOT NULL DEFAULT '4999-PROV',
  debit_satang    bigint NOT NULL DEFAULT 0,
  credit_satang   bigint NOT NULL DEFAULT 0,
  -- status: 'pending' | 'reclassified' | 'reversed'
  status          varchar(20) NOT NULL DEFAULT 'pending',
  reclassified_gl_code varchar(20) DEFAULT NULL,
  reclassified_by uuid DEFAULT NULL,
  reclassified_at timestamptz DEFAULT NULL,
  reversed_at     timestamptz DEFAULT NULL,
  reversed_by     uuid DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_prov_status CHECK (status IN ('pending','reclassified','reversed'))
);

-- One provisional GL per unmatched txn (can be reversed when txn gets matched)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_prov_gl_txn_uidx
  ON public.ledger_bank_provisional_gl (bank_txn_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ledger_bank_prov_gl_org_co_period_idx
  ON public.ledger_bank_provisional_gl (org_id, company_id, period);

ALTER TABLE public.ledger_bank_provisional_gl ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_prov_gl_org_policy ON public.ledger_bank_provisional_gl
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
