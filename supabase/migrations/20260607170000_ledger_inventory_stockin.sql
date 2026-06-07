-- LedgerLine — Inventory STOCK-IN (resale goods → รับเข้าสต๊อก TRCloud)
--
-- Verified mechanism (live write-test on company 45, 2026-06-07): ap/create with
-- company_format=JPS_AP + a stock product (status='show') + quantity INCREASES the
-- TRCloud stock balance immediately (on create, even as draft). LedgerLine becomes
-- the SINGLE stock-IN writer (replaces manual AP keying); POS does stock-OUT.
--
-- This migration is ADDITIVE — with the LEDGER_STOCKIN_V1 flag OFF nothing reads
-- these tables, so the runtime is byte-equivalent to today.

-- 1) Cache of TRCloud product SKUs (pulled from inventory/search per business group).
--    NEVER created from OCR — only mirrored from TRCloud. `business_group` = TRCloud's
--    `category` field (e.g. "ธุรกิจ_สถานีบริการ" / "กลุ่ม_ธุรกิจ โรงแรม") which segments
--    SKUs per business. `stock_tracked` = admin opt-in (only these can produce a stock-IN).
CREATE TABLE IF NOT EXISTS public.ledger_trcloud_sku (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  company_id     uuid NOT NULL,
  product_id     text NOT NULL,             -- TRCloud SKU code (OIL_G95 / LUB-0004 / H_S0001)
  product_name   text,
  business_group text,                      -- TRCloud `category` field (business-line tag)
  unit           text,                      -- ลิตร / ขวด / ลัง
  pack_factor    numeric(15,4) NOT NULL DEFAULT 1,  -- receipt pack → stock base unit (1 ลัง = N ขวด)
  stock_tracked  boolean NOT NULL DEFAULT false,    -- admin opt-in: this SKU receives stock
  status         text,                      -- TRCloud status (show=สินค้า/hide=บริการ)
  balance_cached numeric(15,4),             -- last-synced on-hand (display only)
  cost_cached    numeric(15,4),             -- last-synced moving-avg cost (display only)
  synced_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_trcloud_sku_org_company_product_key UNIQUE (org_id, company_id, product_id)
);
CREATE INDEX IF NOT EXISTS ledger_trcloud_sku_scope_idx
  ON public.ledger_trcloud_sku (org_id, company_id, business_group, stock_tracked);

-- 2) Learned alias: receipt line text → a cached SKU. exact-match-first; first sight
--    the admin maps it, later identical text auto-resolves. No match = flag (never guess).
CREATE TABLE IF NOT EXISTS public.ledger_sku_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  sku_id      uuid NOT NULL,
  alias_key   text NOT NULL,                -- normalized receipt text (lower/trim/collapse-space)
  source      text NOT NULL DEFAULT 'admin',-- admin | auto
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_sku_alias_org_company_key_key UNIQUE (org_id, company_id, alias_key)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_sku_alias_sku_id_fkey') THEN
    ALTER TABLE public.ledger_sku_alias
      ADD CONSTRAINT ledger_sku_alias_sku_id_fkey
      FOREIGN KEY (sku_id) REFERENCES public.ledger_trcloud_sku(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ledger_sku_alias_sku_idx
  ON public.ledger_sku_alias (org_id, company_id, sku_id);

-- 3) Stamp the stock-IN result on the expense (separate from the expense-AP push fields).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_stockin_doc_id text,
  ADD COLUMN IF NOT EXISTS trcloud_stockin_no     text,
  ADD COLUMN IF NOT EXISTS trcloud_stockin_at     timestamptz,
  ADD COLUMN IF NOT EXISTS trcloud_stockin_error  text;

-- RLS — org isolation (same pattern as every ledger table).
ALTER TABLE public.ledger_trcloud_sku ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_trcloud_sku_org_isolation" ON public.ledger_trcloud_sku;
CREATE POLICY "ledger_trcloud_sku_org_isolation" ON public.ledger_trcloud_sku
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_sku_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_sku_alias_org_isolation" ON public.ledger_sku_alias;
CREATE POLICY "ledger_sku_alias_org_isolation" ON public.ledger_sku_alias
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

COMMENT ON TABLE public.ledger_trcloud_sku IS
  'Cache ของ SKU จาก TRCloud (mirror inventory/search ต่อธุรกิจ). stock_tracked=admin เลือกว่าตัวไหนรับเข้าสต๊อก. ไม่สร้าง SKU เอง.';
COMMENT ON TABLE public.ledger_sku_alias IS
  'จับคู่ชื่อสินค้าบนใบเสร็จ → SKU. exact-match จำได้ ครั้งแรก admin map. ไม่เจอ=flag ไม่เดา.';
