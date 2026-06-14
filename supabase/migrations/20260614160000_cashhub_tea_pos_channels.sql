-- CashHub ร้านชาไข่มุก — Phase 2 (เทียบ POS Foodstory แยกช่องทาง + เตรียม reconcile)
-- 1) เก็บยอดแยกช่องทางต่อวัน (เงินสด/QR/EDC/Grab/Lineman/Shopee/wallet/ส่วนลด) ใน jsonb
-- 2) ตั้งค่าต่อช่องทาง: บริษัท + บัญชีธนาคารที่เงินเข้า + ค่าธรรมเนียม → เตรียมส่งเข้า reconcile
--    (มิเรอร์ cashhub_amazon_channel_config). super_admin แก้.

-- per-day channel breakdown: { "cash": 3856, "qr": 6888, "grab": 395, ... } (บาท)
ALTER TABLE public.cashhub_tea_daily
  ADD COLUMN IF NOT EXISTS pos_channels jsonb;

CREATE TABLE IF NOT EXISTS public.cashhub_tea_channel_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  channel_code      varchar(24) NOT NULL,        -- cash | qr | card | grab | lineman | shopee | wallet | discount
  label             varchar(80),
  is_settle         boolean NOT NULL DEFAULT true, -- เป็นเงินเข้าธนาคารจริงไหม (ส่วนลด/แต้ม = false)
  fee_percent       numeric(6,3) NOT NULL DEFAULT 0,
  min_settle_satang bigint NOT NULL DEFAULT 0,    -- ยอด/วันต่ำกว่านี้ = ยังไม่โอน (เช่น Lineman)
  company_id        uuid,                          -- บริษัทที่เงินเข้า (companies.id)
  bank_account_id   uuid,                          -- บัญชีปลายทาง (ledger_bank_account.id)
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_code)                    -- 1 ค่าตั้ง/ช่องทาง/องค์กร
);

ALTER TABLE public.cashhub_tea_channel_config ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือนตาราง cashhub อื่น — query scope org_id เสมอ
