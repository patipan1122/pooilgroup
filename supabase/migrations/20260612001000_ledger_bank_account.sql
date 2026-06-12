-- LedgerLine — Bank Statement Reconciliation, Table 1/6: ledger_bank_account
-- กระทบยอดธนาคาร (bank-recon): 3-plane architecture
--   Bank plane  = ledger_bank_txn        (immutable after import)
--   Book plane  = ledger_expense / ledger_payment / ledger_payment_request (existing)
--   Match plane = ledger_bank_match      (mutable junction)
--
-- This migration: bank account master table + company junction.
-- Feature-flagged in code behind LEDGER_BANK_RECON_V1 (additive, ships un-flagged).

-- ============================================================
-- 1. ledger_bank_account — one row per physical bank book/account
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_bank_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  -- display
  bank_code       varchar(10)  NOT NULL,   -- 'KBANK' | 'SCB' | 'TTB' | 'BBL' | 'BAAC'
  account_no      varchar(30)  NOT NULL,   -- masked in UI (last 4 visible), stored full for matching
  account_name    varchar(200) NOT NULL,
  account_type    varchar(20)  NOT NULL DEFAULT 'savings', -- 'savings' | 'current' | 'card_terminal'
  -- MDR (Merchant Discount Rate) for card terminal accounts
  mdr_rate        numeric(6,5) DEFAULT 0,  -- e.g. 0.01400 = 1.40%
  mdr_gl_account  varchar(20)  DEFAULT NULL, -- GL account code for MDR fee expense
  is_active       boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_bank_code CHECK (bank_code IN ('KBANK','SCB','TTB','BBL','BAAC','KTB','BAY','CIMB','UOB','OTHER'))
);

CREATE INDEX IF NOT EXISTS ledger_bank_account_org_idx
  ON public.ledger_bank_account (org_id);

-- ============================================================
-- 2. ledger_bank_account_company — junction: which companies can see/import which accounts
-- (D4: PDPA requires company-scoped access even for shared bank accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_bank_account_company (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.ledger_bank_account(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL,
  can_import      boolean NOT NULL DEFAULT false,  -- can upload CSV/do manual entry
  can_view        boolean NOT NULL DEFAULT true,   -- can view transactions
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, company_id)
);

CREATE INDEX IF NOT EXISTS ledger_bank_account_company_org_co_idx
  ON public.ledger_bank_account_company (org_id, company_id);

-- RLS: org-scoped, no cross-org leak
ALTER TABLE public.ledger_bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_bank_account_company ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_account_org_policy ON public.ledger_bank_account
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));

CREATE POLICY ledger_bank_account_company_org_policy ON public.ledger_bank_account_company
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
