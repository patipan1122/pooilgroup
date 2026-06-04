-- LedgerLine — Phase 3 (Bainy-parity data depth + multi-image capture batch)
-- 2026-06-04 · Adds:
--   1. ledger_expense — Bainy edit-form fields (doc type, vendor doc no./address/
--      branch code, discount, payment status, claimant, recurring, attachments)
--      + capture_batch_id so several receipts sent together share one summary card.
--   2. ledger_capture_batch — debounce buffer: when staff send 4-5 photos in a
--      burst, each becomes its own draft but they're grouped → ONE LINE carousel.
--
-- Pattern mirrors 20260603210000_ledger_line_phase2.sql (RLS org_id =
-- current_org_id() OR is_super_admin()). Idempotent — safe to re-run.
-- Column types match schema.prisma. Apply with: supabase db push (or Mgmt API).

-- ============================================================
-- 1. ledger_expense — Bainy-parity fields + capture batch link
-- ============================================================
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS doc_type          text NOT NULL DEFAULT 'tax_invoice', -- ใบกำกับภาษี/ใบเสร็จ/บิลเงินสด/ใบส่งของ/อื่นๆ
  ADD COLUMN IF NOT EXISTS vendor_doc_number text,                                -- เลขที่เอกสาร (ของผู้ขาย — คนละตัวกับ doc_code ภายใน)
  ADD COLUMN IF NOT EXISTS vendor_address    text,                                -- ที่อยู่ผู้ขาย
  ADD COLUMN IF NOT EXISTS vendor_branch_code text,                               -- รหัสสาขาผู้ขาย
  ADD COLUMN IF NOT EXISTS discount          numeric(15,2) NOT NULL DEFAULT 0,    -- ส่วนลด
  ADD COLUMN IF NOT EXISTS payment_status    text NOT NULL DEFAULT 'paid',        -- paid | unpaid | partial
  ADD COLUMN IF NOT EXISTS claimant_name     text,                                -- ชื่อผู้เบิก
  ADD COLUMN IF NOT EXISTS bank_detail       text,                                -- ชื่อธนาคาร/รายละเอียดการจ่าย
  ADD COLUMN IF NOT EXISTS is_recurring      boolean NOT NULL DEFAULT false,      -- ตั้งเป็นรายจ่ายประจำ
  ADD COLUMN IF NOT EXISTS attachments       jsonb,                               -- [{url,kind:'po'|'evidence',name}] PO + หลักฐานเพิ่มเติม
  ADD COLUMN IF NOT EXISTS capture_batch_id  uuid;                                -- groups receipts sent in one burst → one card

CREATE INDEX IF NOT EXISTS ledger_expense_capture_batch_idx
  ON public.ledger_expense (capture_batch_id);

-- ============================================================
-- 2. ledger_capture_batch — debounced multi-image buffer
--    A burst of photos (album) lands as separate webhook events; we group them
--    here, debounce ~3s of quiet, then flush ONE carousel via the stored reply
--    token (free) → push fallback. status flips open→sent atomically (exactly-once).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_capture_batch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  channel_row_id  uuid NOT NULL,                    -- ledger_line_channel.id
  group_key       text NOT NULL,                    -- groupId (group) or userId (1:1) — where to push
  source_type     text NOT NULL DEFAULT 'group',    -- 'group' | 'user'
  reply_token     text,                             -- freshest LINE replyToken (used to reply free at flush)
  status          text NOT NULL DEFAULT 'open',     -- 'open' | 'sent'
  count           integer NOT NULL DEFAULT 0,
  last_event_at   timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_capture_batch_open_idx
  ON public.ledger_capture_batch (channel_row_id, group_key, status, last_event_at);

-- ============================================================
-- RLS — org isolation (mirror current_org_id() pattern)
-- ============================================================
ALTER TABLE public.ledger_capture_batch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_capture_batch_org_isolation" ON public.ledger_capture_batch;
CREATE POLICY "ledger_capture_batch_org_isolation" ON public.ledger_capture_batch
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- Verification (run manually after apply)
-- ============================================================
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='ledger_expense' AND column_name IN
--     ('doc_type','vendor_doc_number','discount','claimant_name','is_recurring','attachments','capture_batch_id');
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename='ledger_capture_batch';
