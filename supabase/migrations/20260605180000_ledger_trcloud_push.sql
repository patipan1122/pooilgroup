-- LedgerLine → TRCloud API push (เชื่อมบัญชี TRCloud แบบสมบูรณ์).
--
-- LedgerLine COMPLEMENTS TRCloud: a confirmed expense is pushed INTO TRCloud as an
-- AP (ใบกำกับภาษีซื้อ) via api-connector2. To avoid duplicate masters in the shared
-- book, we keep two tiny "search-before-create" maps so a vendor / product is
-- created in TRCloud ONCE and reused forever after (TRCloud dedups by contact_id /
-- product_id). The push result (doc id/number) is stamped back on the expense so it
-- can never be double-pushed + the list can show a "ส่งแล้ว" status.
--
-- Purely additive + idempotent — cannot alter or corrupt any existing row.

-- 1) Push tracking on the expense (idempotency + status badge + retry-on-error).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_doc_id   text,
  ADD COLUMN IF NOT EXISTS trcloud_doc_no   text,
  ADD COLUMN IF NOT EXISTS trcloud_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS trcloud_error    text;

-- Filter "ส่งแล้ว / ยังไม่ส่ง" fast.
CREATE INDEX IF NOT EXISTS ledger_expense_trcloud_pushed_idx
  ON public.ledger_expense (org_id, company_id, trcloud_pushed_at);

-- 2) Vendor map: TRCloud contact_id per (org, company, tax_id). One row = "we have
--    already created/located this vendor in TRCloud, reuse its id". tax_id "" is the
--    bucket for cash/no-tax-id receipts (one shared "เจ้าหนี้เบ็ดเตล็ด" contact).
CREATE TABLE IF NOT EXISTS public.ledger_trcloud_contact (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  tax_id      text        NOT NULL DEFAULT '',
  contact_id  text        NOT NULL,            -- TRCloud system contact id
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_trcloud_contact_key
  ON public.ledger_trcloud_contact (org_id, company_id, tax_id);

-- 3) Product map: TRCloud product_id (SKU) per (org, company, name_key). name_key =
--    normalized line description (or a category fallback) → same item never creates a
--    second SKU.
CREATE TABLE IF NOT EXISTS public.ledger_trcloud_product (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL,
  company_id   uuid        NOT NULL,
  name_key     text        NOT NULL,
  product_id   text        NOT NULL,           -- TRCloud SKU code
  product_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_trcloud_product_key
  ON public.ledger_trcloud_product (org_id, company_id, name_key);

-- RLS — same org-isolation policy as the rest of the ledger module.
ALTER TABLE public.ledger_trcloud_contact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_trcloud_contact_org_isolation" ON public.ledger_trcloud_contact;
CREATE POLICY "ledger_trcloud_contact_org_isolation" ON public.ledger_trcloud_contact
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_trcloud_product ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_trcloud_product_org_isolation" ON public.ledger_trcloud_product;
CREATE POLICY "ledger_trcloud_product_org_isolation" ON public.ledger_trcloud_product
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

COMMENT ON TABLE public.ledger_trcloud_contact IS
  'LedgerLine→TRCloud vendor map: tax_id → TRCloud contact_id (search-before-create dedup). tax_id="" = shared เจ้าหนี้เบ็ดเตล็ด bucket.';
COMMENT ON TABLE public.ledger_trcloud_product IS
  'LedgerLine→TRCloud product map: normalized line name → TRCloud product_id/SKU (dedup, never re-create the same item).';
