-- DocuFlow · Document cost/expense metadata (CEO spec, WORKSHOP_docuflow-org-structure
-- 2026-10-10, Must #6) — amount + label + a 3-option frequency (รายเดือน/รายปี/
-- จ่ายครั้งเดียว). Standalone reference info stamped on the document itself,
-- explicitly NOT linked to Ledger/CashHub.
--
-- ADDITIVE ONLY · all columns nullable · IF NOT EXISTS = safe, no existing row touched
-- (null = today's behavior exactly — nobody has ever filled this in before).
--
-- cost_amount uses NUMERIC(12,2) (Prisma Decimal), not float/real, to avoid rounding
-- error even though this is just reference metadata, not a real accounting figure.
-- cost_frequency is a plain TEXT column (app-validated: monthly | yearly | one_time),
-- matching this table's existing convention for small closed sets rather than a new
-- Postgres enum type.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS "cost_amount" NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS "cost_label" TEXT,
  ADD COLUMN IF NOT EXISTS "cost_frequency" TEXT;
