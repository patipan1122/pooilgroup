-- CashHub Café Amazon — ตั้งค่าการชำระเงินต่อช่องทาง (ค่าธรรมเนียม + บัญชีที่เงินเข้า) → ลิงก์ reconcile
-- super_admin ตั้งได้: แต่ละช่องทาง → ค่าธรรมเนียม% · ยอดขั้นต่ำที่โอน · เข้าบัญชีไหน
-- เงินเข้าจริง = ยอด − ค่าธรรมเนียม (ถ้ายอด/วัน < ขั้นต่ำ = ยังไม่โอน รอสะสม)

CREATE TABLE IF NOT EXISTS public.cashhub_amazon_channel_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  channel_cvar    varchar(8) NOT NULL,        -- c1, c2, c12, c20, ...
  label           varchar(60),                 -- "เงินสด" / "Grab" ฯลฯ
  is_settle       boolean NOT NULL DEFAULT true,   -- เป็นเงินเข้าธนาคารจริงไหม (Redeem/ส่วนลด=false)
  fee_percent     numeric(7,4) NOT NULL DEFAULT 0, -- ค่าธรรมเนียม % (เช่น 0.7, 18)
  min_settle_satang bigint NOT NULL DEFAULT 0,      -- ยอด/วันต่ำกว่านี้ = ยังไม่โอน (รอสะสม) เช่น Lineman 50000 = 500฿
  company_id      uuid,                        -- บริษัทที่เงินเข้า (สำหรับ reconcile)
  bank_account_id uuid,                        -- บัญชีที่เงินเข้า (FK ledger_bank_account)
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_cvar)
);

CREATE INDEX IF NOT EXISTS cashhub_amazon_channel_config_org_idx
  ON public.cashhub_amazon_channel_config (org_id);

ALTER TABLE public.cashhub_amazon_channel_config ENABLE ROW LEVEL SECURITY;

-- ── ledger_revenue_entry: additive (ปลอดภัย — nullable, ของเดิมไม่กระทบ) ──
-- บัญชีที่คาดว่าจะเข้า (จากการตั้งค่าช่องทาง) — ใช้แสดงในหน้า reconcile ว่าควรกระทบกับบัญชีไหน
ALTER TABLE public.ledger_revenue_entry
  ADD COLUMN IF NOT EXISTS expected_bank_account_id uuid;

-- ขยาย source_type ให้รับ 'CASHHUB_AMAZON' (additive — ค่าเดิมยังใช้ได้)
ALTER TABLE public.ledger_revenue_entry
  DROP CONSTRAINT IF EXISTS ledger_revenue_entry_source_type_check;
ALTER TABLE public.ledger_revenue_entry
  ADD CONSTRAINT ledger_revenue_entry_source_type_check
  CHECK (source_type IN ('TRCLOUD_IV','CHAIROPS','CLAWFLEET','FUELOS','WEBHOOK','MANUAL','CASHHUB_AMAZON'));
