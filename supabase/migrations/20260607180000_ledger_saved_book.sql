-- LedgerLine — "เซฟเล่ม" (saved analytics books). 2026-06-07
--
-- A saved filter set for the /ledger/ledger-book spend-analytics view
-- (LEDGER_ANALYTICS_V1). The CEO presses "บันทึกเป็นเล่ม", names it
-- ("ค่าไฟ JPSYNC"), and reopens it later with the same ticks — shared per company
-- (everyone in the company sees the same shelf of books).
--
-- ADDITIVE ONLY (1 table). Stores the FILTER SET (config json), NOT a number
-- snapshot → reopening a book recomputes live from real receipts (numbers stay
-- correct over time; nothing is frozen). categoryId/branchId live inside config
-- (no FK) → if a category/branch is deleted later, reopening just shows
-- "ไม่ระบุ"/empty, never a broken FK.

CREATE TABLE IF NOT EXISTS public.ledger_saved_book (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  name        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { axis, categoryId, branchId, grain, basis, q }
  created_by  uuid,
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz(6) NOT NULL DEFAULT now(),
  updated_at  timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_saved_book_org_company_idx
  ON public.ledger_saved_book (org_id, company_id, sort, created_at);

-- RLS — org isolation (mirror every other ledger_* table). Service role (Prisma)
-- bypasses RLS; this protects any future client path.
ALTER TABLE public.ledger_saved_book ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_saved_book_org_isolation" ON public.ledger_saved_book;
CREATE POLICY "ledger_saved_book_org_isolation" ON public.ledger_saved_book
  FOR ALL
  USING  (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
