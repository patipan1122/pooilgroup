-- LedgerLine — line_message_id dedup + export_batch updated_at + doc_date comment.
-- 2026-06-07
--
-- 1. ledger_expense.line_message_id: dedup gate for LINE webhook messages.
--    A LINE message ID is globally unique per message sent. Storing it here lets
--    the webhook handler block double-processing (webhook retry or load-balanced
--    duplicate delivery) at the DB layer without an explicit advisory lock.
--    Column is nullable; only rows created from LINE have it set.
--
-- 2. ledger_export_batch.updated_at: was missing from the init migration
--    (20260602190000 defined the table without updated_at). Adding it now with
--    DEFAULT now() so new rows auto-populate; existing rows get the migration timestamp.
--
-- 3. doc_date comment: enforced at the application layer (accountant confirm gate)
--    before confirming an expense. The DB column stays nullable so partial drafts
--    can be saved without a date, but the app refuses to confirm without it.
--
-- All DDL uses IF NOT EXISTS / COMMENT (idempotent). Safe to re-run.

-- ============================================================
-- 1. ledger_expense — line_message_id column + partial unique index
-- ============================================================
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS line_message_id text;

-- Dedup: one expense per (org, company, LINE message). Partial — only messages
-- originating from LINE have this set; web/email entries stay NULL and never collide.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_expense_line_message_id_unique
  ON public.ledger_expense (org_id, company_id, line_message_id)
  WHERE line_message_id IS NOT NULL;

-- ============================================================
-- 2. ledger_export_batch — add missing updated_at column
-- ============================================================
ALTER TABLE public.ledger_export_batch
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- 3. ledger_expense.doc_date — application-layer enforcement note
-- ============================================================
COMMENT ON COLUMN public.ledger_expense.doc_date IS
  'Required before confirm — enforced at application layer (accountant confirm gate rejects null). Nullable so drafts can be saved without a date.';
