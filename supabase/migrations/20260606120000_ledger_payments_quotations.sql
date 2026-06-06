-- LedgerLine — Payments + Quotations FOUNDATION (PR1).
--
-- Adds (1) a column to map a sent LINE confirm-card → its bill so a slip replied
-- to that card matches the EXACT expense (reply-to-bill, D2), and (2) a first-class
-- payment-slip table that powers "mark paid" + duplicate-payment detection.
--
-- The dup key is the bank's own transaction reference, decoded for FREE from the
-- slip's EMVCo/PromptPay mini-QR (lib/ledger/slip-qr.ts, PR2) — no paid API, no AI.
-- never-auto-post is unchanged. Quotations do NOT get a new status; they are normal
-- confirmed expenses (they ARE real spend per CEO D1) flagged docType='quotation',
-- kept out of TRCloud + VAT-claimable by app guards, superseded by the real invoice.
--
-- Purely additive + idempotent (IF NOT EXISTS everywhere, guarded FK, DROP/CREATE
-- policy). No enum change, no DEFAULT change → cannot alter or corrupt any existing
-- row. Safe to re-run. Does not touch ledger_trcloud_* / ledger_input_vat columns.

-- 1) Map a sent LINE confirm-card to its bill (reply-to-bill, D2). Additive nullable.
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS line_confirm_message_id text;

CREATE INDEX IF NOT EXISTS ledger_expense_line_confirm_msg_idx
  ON public.ledger_expense (org_id, company_id, line_confirm_message_id);

-- 2) Payment slips as a first-class entity (1 bill : N payments — N reserved for the
--    v2 partial/split case). Money as numeric(15,2) (module convention — exact, never
--    float). RLS-scoped + app always filters org_id AND company_id (the P0 cross-company
--    leak lesson) — Postgres RLS is org-only, the company filter lives in app queries.
CREATE TABLE IF NOT EXISTS public.ledger_payment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  company_id          uuid NOT NULL,
  matched_expense_id  uuid,
  amount              numeric(15, 2) NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'THB',
  method              text NOT NULL DEFAULT 'transfer', -- transfer | cash | qr
  sending_bank        text,
  trans_ref           text,    -- EMVCo/PromptPay slip-QR transaction ref (free local decode)
  slip_sha256         text,    -- image hash (silent same-image dedup)
  slip_url            text,
  slip_thumb_url      text,
  qr_raw              text,    -- raw EMVCo payload (audit + QR hit-rate metric)
  qr_decoded          boolean NOT NULL DEFAULT false,
  paid_at             timestamptz,
  marked_by           uuid,
  dup_override_by     uuid,
  dup_override_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- FK: payment → bill. Keep the slip (audit) if the bill is deleted, just null the link.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_payment_matched_expense_id_fkey'
  ) THEN
    ALTER TABLE public.ledger_payment
      ADD CONSTRAINT ledger_payment_matched_expense_id_fkey
      FOREIGN KEY (matched_expense_id) REFERENCES public.ledger_expense(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Dup-PAYMENT: same bank + transaction ref = the same transfer → BLOCK (partial index,
-- NULL refs never collide → monthly same-amount bills with different refs don't false-block).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_org_bank_ref_key
  ON public.ledger_payment (org_id, sending_bank, trans_ref)
  WHERE trans_ref IS NOT NULL;
-- Dup-SLIP: same image hash → silent block (resent photo).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_org_slipsha_key
  ON public.ledger_payment (org_id, slip_sha256)
  WHERE slip_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_payment_matched_idx
  ON public.ledger_payment (org_id, company_id, matched_expense_id);

-- RLS — org isolation (mirror current_org_id() pattern, like every ledger table).
ALTER TABLE public.ledger_payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_payment_org_isolation" ON public.ledger_payment;
CREATE POLICY "ledger_payment_org_isolation" ON public.ledger_payment
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

COMMENT ON TABLE public.ledger_payment IS
  'หลักฐานการจ่ายเงิน (สลิปโอน) ผูกกับ ledger_expense. กันจ่ายซ้ำด้วย (sending_bank, trans_ref) จาก QR สลิป (ถอด offline ฟรี). never-auto-post.';
COMMENT ON COLUMN public.ledger_payment.trans_ref IS
  'เลขอ้างอิงธุรกรรมจาก EMVCo/PromptPay QR บนสลิป (ถอด offline). unique ต่อ org → กันจ่ายซ้ำแบบ deterministic 0 token.';
COMMENT ON COLUMN public.ledger_expense.line_confirm_message_id IS
  'messageId ของการ์ดยืนยันที่บอทส่งในไลน์ → ใช้จับคู่สลิปที่ reply การ์ดนั้นเข้ากับบิลใบนี้ (reply-to-bill).';
