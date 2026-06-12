-- LedgerLine Bank Recon — PEAK-parity N:M matching (2026-06-12)
-- PEAK lets you reconcile a GROUP: select N bank movements + M book entries whose
-- sums balance, match them together (e.g. 1 invoice ฿32,100 ↔ 2 deposits ฿16,050).
-- The old 1:1 ledger_bank_match can't express this, so we add a group + item model.
--
-- Flow (PEAK 2-step):
--   1. รอกระทบยอด: select book + bank → "จับคู่อัตโนมัติ" → group(status=suggested)
--   2. รอยืนยัน:   review groups → "กระทบยอดทั้งหมด" → group(status=confirmed)

-- ── group header ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_bank_match_group (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  company_id        uuid NOT NULL,
  bank_account_id   uuid NOT NULL REFERENCES public.ledger_bank_account(id) ON DELETE RESTRICT,
  status            varchar(20) NOT NULL DEFAULT 'suggested'
                    CHECK (status IN ('suggested','confirmed','reversed')),
  match_kind        varchar(20) NOT NULL DEFAULT 'manual'
                    CHECK (match_kind IN ('auto','manual')),
  bank_total_satang bigint NOT NULL DEFAULT 0,  -- signed sum of bank items
  book_total_satang bigint NOT NULL DEFAULT 0,  -- signed sum of book items
  delta_satang      bigint NOT NULL DEFAULT 0,  -- bank_total - book_total
  note              text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_by      uuid,
  confirmed_at      timestamptz,
  reversed_by       uuid,
  reversed_at       timestamptz,
  reversal_reason   text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_bank_match_group_acct_status_idx
  ON public.ledger_bank_match_group (org_id, company_id, bank_account_id, status);

-- ── group items (one row per selected bank movement OR book entry) ────────────
CREATE TABLE IF NOT EXISTS public.ledger_bank_match_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.ledger_bank_match_group(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL,
  kind          varchar(10) NOT NULL CHECK (kind IN ('bank','book')),
  -- when kind='bank'
  bank_txn_id   uuid REFERENCES public.ledger_bank_txn(id) ON DELETE RESTRICT,
  -- when kind='book'
  book_type     varchar(20),  -- 'revenue' | 'expense' | 'payment' | 'payment_request'
  book_id       uuid,
  book_doc_no   varchar(100),
  amount_satang bigint NOT NULL,  -- signed
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_bank_match_item_group_idx
  ON public.ledger_bank_match_item (group_id);
CREATE INDEX IF NOT EXISTS ledger_bank_match_item_bank_idx
  ON public.ledger_bank_match_item (bank_txn_id) WHERE bank_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_bank_match_item_book_idx
  ON public.ledger_bank_match_item (book_type, book_id) WHERE book_id IS NOT NULL;

-- A bank txn / book entry may sit in only ONE active group. We can't reference the
-- parent group's status from a partial index, so app logic enforces "active only"
-- and these uniques stop hard double-links regardless of status.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_item_bank_uniq
  ON public.ledger_bank_match_item (bank_txn_id) WHERE bank_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_item_book_uniq
  ON public.ledger_bank_match_item (book_type, book_id) WHERE book_id IS NOT NULL;

-- RLS (org-scoped; Prisma bypasses it, app self-scopes too)
ALTER TABLE public.ledger_bank_match_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_bank_match_item  ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_bank_match_group_org_policy ON public.ledger_bank_match_group
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
CREATE POLICY ledger_bank_match_item_org_policy ON public.ledger_bank_match_item
  USING (org_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid));
