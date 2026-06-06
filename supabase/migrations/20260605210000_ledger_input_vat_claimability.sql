-- LedgerLine — ภาษีซื้อ (Input-VAT claimability) FOUNDATION.
--
-- Adds the buyer-verification + completeness-grade fields onto an expense so the
-- module can answer "ใบนี้เอาภาษีซื้อไปขอคืนได้ไหม?". The decision is made by the
-- deterministic engine in lib/ledger/recheck.ts (NOT AI) and keyed on the buyer's
-- 13-digit tax id matched EXACTLY (never the name / OCR confidence — that is the
-- whole anti-false-accept guarantee). never-auto-post is unchanged; these columns
-- are written by recheck + accountant override, not by a posting step.
--
-- Purely additive + idempotent (ADD COLUMN IF NOT EXISTS, guarded FK, IF NOT EXISTS
-- index). Cannot alter or corrupt any existing row. Backfill = DEFAULT only — every
-- existing expense lands on completeness_status='undecided' / input_vat_claimable=NULL,
-- so confirmed/locked rows are never silently re-graded. Does NOT touch ledger_trcloud_*
-- (parallel session) and does not collide with migration ...180000 / ...200000.

-- 1) Buyer snapshot (from master, not OCR) + the tax id the OCR read off the doc,
--    + the verify result. Enums are plain text + a TS union in lib/ledger/types.ts
--    (module convention — docType/status are all String).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS buyer_tax_id_snapshot   text,
  ADD COLUMN IF NOT EXISTS buyer_name_snapshot     text,
  ADD COLUMN IF NOT EXISTS buyer_tax_id_on_doc      text,
  ADD COLUMN IF NOT EXISTS buyer_match_status       text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS completeness_status      text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS completeness_missing     jsonb,
  ADD COLUMN IF NOT EXISTS completeness_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS input_vat_claimable      boolean,
  ADD COLUMN IF NOT EXISTS input_vat_block_reason   text,
  ADD COLUMN IF NOT EXISTS replacement_of_id        uuid,
  ADD COLUMN IF NOT EXISTS replaced_by_id           uuid,
  ADD COLUMN IF NOT EXISTS override_by              uuid,
  ADD COLUMN IF NOT EXISTS override_at              timestamptz,
  ADD COLUMN IF NOT EXISTS override_reason          text;

-- 2) Self-FK: replacement_of_id → ledger_expense(id). When the replaced (original)
--    row is deleted, null the pointer rather than cascading — we keep both docs.
--    Constraint name matches Prisma's default for the "ExpenseReplacement" relation.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_expense_replacement_of_id_fkey'
  ) THEN
    ALTER TABLE public.ledger_expense
      ADD CONSTRAINT ledger_expense_replacement_of_id_fkey
      FOREIGN KEY (replacement_of_id) REFERENCES public.ledger_expense(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Filter/summary by colour status fast (รายการ + แถบสรุป).
CREATE INDEX IF NOT EXISTS ledger_expense_completeness_idx
  ON public.ledger_expense (org_id, company_id, completeness_status);

-- Lookup the replacement chain (ใบไหนทดแทนใบไหน).
CREATE INDEX IF NOT EXISTS ledger_expense_replacement_of_idx
  ON public.ledger_expense (replacement_of_id);

-- 4) Buyer master backfill: seed ships JP Sync (code='JPSYNC') with tax_id=NULL.
--    Fill the official เจพีซิ้งค์ tax id ONLY when still null (never overwrite a
--    value an admin may already have set). The buyer verify can't match anything
--    until this is present.
UPDATE public.companies
   SET tax_id = '0305564001581'
 WHERE code = 'JPSYNC'
   AND tax_id IS NULL;

COMMENT ON COLUMN public.ledger_expense.buyer_tax_id_on_doc IS
  'เลขภาษีผู้ซื้อที่ OCR อ่านได้บนเอกสาร (audit). การตัดสิน match ใช้เลข 13 หลักเป๊ะกับ buyer_tax_id_snapshot ไม่ใช่ชื่อ/confidence.';
COMMENT ON COLUMN public.ledger_expense.completeness_status IS
  'green_full | yellow_partial | red_invalid | undecided — เกรด ม.86/4 แบบ deterministic จาก lib/ledger/recheck.ts.';
COMMENT ON COLUMN public.ledger_expense.input_vat_claimable IS
  'ภาษีซื้อขอคืนได้ไหม (null = ยังไม่ตัดสิน). ใช้ยอด vat เดิม ไม่เก็บเลขซ้ำ.';
