-- LedgerLine — payment-request ("ขอโอนเงิน") + reconcile foundation. 2026-06-07
--
-- The daily AP loop: operation selects bills → "ขอโอนเงิน" → a request card is
-- pushed to the executive (= slip-intake) LINE group → executive transfers + drops
-- the slip back → the slip is matched to the REQUEST (not amount-guessed) → every
-- bill in the request flips to paid in ONE transaction → the accountant reconciles.
--
-- ADDITIVE ONLY (ships un-flagged behind LEDGER_PAYREQ_V1 in code):
--   • ledger_payment_request        — the request header (+ frozen payee snapshot
--                                      + 3 immutable amounts: gross / wht / expected).
--   • ledger_payment_request_bill   — 1 request : N bills (D3 batch). `active` frees
--                                      the 1-open-request-per-bill guard on close.
--   • ledger_payment.payment_request_id — links a slip to its request.
--
-- `state` is a TEXT column (open|partial|paid|cancelled|abnormal|reversed) to match
-- the paymentStatus / role / method text convention — no PG enum to ALTER later.
--
-- 1-OPEN-REQUEST-PER-BILL is a PARTIAL UNIQUE INDEX (race-proof anti double-pay at
-- the DB level, not an app if-check) — same pattern as the slip transRef dedup index
-- (20260606120000 / 20260607120000). Prisma 5 can't express partial indexes → SQL here
-- + P2002 handling in the server action.

-- ============================================================
-- 1. ledger_payment_request — the request header
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_payment_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  company_id        uuid NOT NULL,
  branch_id         uuid,
  vendor            text,
  -- payee snapshot (D4) — FROZEN at request time (immutable evidence; editing a
  -- vendor master later must NOT rewrite old requests).
  payee_acct_name   text,
  payee_bank_code   text,
  payee_acct_no     text,
  payee_promptpay   text,
  payee_qr_payload  text,
  -- 3 immutable amount snapshots (W-028: gross vs wht vs net are different dials).
  bills_gross       numeric(15,2) NOT NULL DEFAULT 0,
  wht_total         numeric(15,2) NOT NULL DEFAULT 0,
  expected_transfer numeric(15,2) NOT NULL DEFAULT 0,  -- = gross - wht (match slips on THIS)
  paid_total        numeric(15,2) NOT NULL DEFAULT 0,  -- Σ matched slips
  state             text NOT NULL DEFAULT 'open',      -- open|partial|paid|cancelled|abnormal|reversed
  abnormal_reason   text,
  requested_by      uuid,
  requested_at      timestamptz(6) NOT NULL DEFAULT now(),
  pushed_group_id   text,    -- LINE group id the card was pushed to (executive/slip group)
  pushed_message_id text,    -- the card's message id (reply-to-card match, tier-1)
  paid_by           text,    -- LINE userId of the payer (from the slip event)
  slip_uploaded_by  uuid,    -- pool user id if the slip was attached on the web/LIFF
  paid_at           timestamptz(6),
  cancelled_by      uuid,
  cancelled_at      timestamptz(6),
  created_at        timestamptz(6) NOT NULL DEFAULT now(),
  updated_at        timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_payment_request_org_company_state_idx
  ON public.ledger_payment_request (org_id, company_id, state);
CREATE INDEX IF NOT EXISTS ledger_payment_request_org_company_reqat_idx
  ON public.ledger_payment_request (org_id, company_id, requested_at DESC);

-- ============================================================
-- 2. ledger_payment_request_bill — 1 request : N bills (D3)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_payment_request_bill (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  request_id  uuid NOT NULL REFERENCES public.ledger_payment_request(id) ON DELETE CASCADE,
  expense_id  uuid NOT NULL,
  bill_amount numeric(15,2) NOT NULL DEFAULT 0,
  bill_wht    numeric(15,2) NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,  -- false once the request closes/cancels → frees the bill
  created_at  timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_payment_request_bill_request_idx
  ON public.ledger_payment_request_bill (org_id, company_id, request_id);
CREATE INDEX IF NOT EXISTS ledger_payment_request_bill_expense_idx
  ON public.ledger_payment_request_bill (org_id, company_id, expense_id);
-- THE anti-double-pay guard: a bill can sit in AT MOST ONE active (open/partial)
-- request at a time. Closing/cancelling sets active=false → the bill can be requested
-- again. A concurrent 2nd "ขอโอน" on the same bill hits this index → P2002.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_request_bill_one_open_per_bill
  ON public.ledger_payment_request_bill (org_id, company_id, expense_id)
  WHERE active;

-- ============================================================
-- 3. ledger_payment.payment_request_id — link a slip to its request
-- ============================================================
ALTER TABLE public.ledger_payment ADD COLUMN IF NOT EXISTS payment_request_id uuid;
CREATE INDEX IF NOT EXISTS ledger_payment_org_company_reqid_idx
  ON public.ledger_payment (org_id, company_id, payment_request_id);

-- ============================================================
-- 4. RLS — org isolation (mirror every other ledger_* table).
--    Service role (Prisma) bypasses RLS; this protects any future client path.
-- ============================================================
ALTER TABLE public.ledger_payment_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_payment_request_org_isolation" ON public.ledger_payment_request;
CREATE POLICY "ledger_payment_request_org_isolation" ON public.ledger_payment_request
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_payment_request_bill ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_payment_request_bill_org_isolation" ON public.ledger_payment_request_bill;
CREATE POLICY "ledger_payment_request_bill_org_isolation" ON public.ledger_payment_request_bill
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
