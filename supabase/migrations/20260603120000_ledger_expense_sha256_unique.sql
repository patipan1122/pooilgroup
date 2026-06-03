-- LedgerLine — concurrent-dedup guard for receipt images.
-- 2026-06-03
--
-- Why: createDraftExpenseCore() dedups by sha256 with a read-then-write
-- (findFirst → create) and NO DB constraint. Two concurrent uploads of the SAME
-- image (a double-click on "อัปโหลดใบเสร็จ", or the same receipt arriving via
-- both LIFF and the LINE webhook) both pass the findFirst check and create
-- duplicate drafts, which then get separately confirmed and double-count in
-- spend / export. This is the NEVER-double-post guarantee — it must be enforced
-- at the DB layer, not just in app code.
--
-- Partial unique index: only rows WITH a sha256 are deduped. sha256 is nullable
-- (manual web entries / OCR-failed captures have none) and Postgres would treat
-- many NULLs as distinct anyway — the WHERE clause makes that explicit and keeps
-- the index small. Scope is (org_id, company_id, sha256) to match the app-layer
-- dedup key (the same image in two different companies stays two rows).
--
-- The app catches the unique-violation (Prisma P2002) on create and re-reads the
-- existing row, returning { duplicate: true } — same shape as the findFirst path.
--
-- Note: NOT expressed as a Prisma @@unique because Prisma can't emit a PARTIAL
-- unique index; a non-partial @@unique would also drift the generated index name.
-- Mirrors the surgical-DDL pattern used for ledger_budget_unique_key in the
-- module-init migration.

CREATE UNIQUE INDEX IF NOT EXISTS ledger_expense_org_company_sha256_key
  ON public.ledger_expense (org_id, company_id, sha256)
  WHERE sha256 IS NOT NULL;
