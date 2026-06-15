-- CashHub ⛽ ปั๊มน้ำมัน — ตั้งค่าช่องทาง → บัญชี/บริษัท (เตรียม reconcile)
-- mirror cashhub_tea_channel_config / cashhub_hotel_channel_config.
-- ตั้งค่าต่อช่องทาง (เงินสด/QR-เงินโอน/บัตร): เป็นเงินเข้าธนาคารจริงไหม + ค่าธรรมเนียม + บัญชีปลายทาง.
-- super_admin แก้ผ่าน /cashhub/fuel-pump62/settings. ADDITIVE ONLY.
CREATE TABLE IF NOT EXISTS public.cashhub_fuel_channel_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  channel_code      varchar(24) NOT NULL,         -- cash | qr | card
  label             varchar(80),
  is_settle         boolean NOT NULL DEFAULT true, -- เป็นเงินเข้าธนาคารจริงไหม
  fee_percent       numeric(6,3) NOT NULL DEFAULT 0,
  min_settle_satang bigint NOT NULL DEFAULT 0,     -- ยอด/วันต่ำกว่านี้ = ยังไม่โอน
  company_id        uuid,                           -- บริษัทที่เงินเข้า (companies.id)
  bank_account_id   uuid,                           -- บัญชีปลายทาง (ledger_bank_account.id)
  active            boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_code)                     -- 1 ค่าตั้ง/ช่องทาง/องค์กร
);
CREATE INDEX IF NOT EXISTS cashhub_fuel_channel_config_org_idx
  ON public.cashhub_fuel_channel_config (org_id);
ALTER TABLE public.cashhub_fuel_channel_config ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือนตาราง cashhub อื่น — query scope org_id เสมอ
