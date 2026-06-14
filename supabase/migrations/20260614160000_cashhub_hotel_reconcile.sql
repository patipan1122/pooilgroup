-- CashHub Hotel — สะพานเชื่อม reconcile: ช่องทาง→บัญชี + ขยาย source_type (CEO 2026-06-14)
-- mirror pattern Café Amazon (cashhub_amazon_channel_config + ledger_revenue_entry bridge).
-- ส่งยอดเข้าจริงของแต่ละวัน/ช่องทาง → ledger_revenue_entry (book side) → นักบัญชีกระทบกับ
--   statement ธนาคารในหน้า bank-recon → match_state='matched' → หน้า hotel ขึ้นเขียว.
-- ADDITIVE — ไม่แตะ revenue entry เดิม.

-- 1) ขยาย source_type ให้รับ 'CASHHUB_HOTEL' (เติมจากชุดเดิม + CASHHUB_AMAZON)
ALTER TABLE public.ledger_revenue_entry
  DROP CONSTRAINT IF EXISTS ledger_revenue_entry_source_type_check;
ALTER TABLE public.ledger_revenue_entry
  ADD CONSTRAINT ledger_revenue_entry_source_type_check
  CHECK (source_type IN ('TRCLOUD_IV','CHAIROPS','CLAWFLEET','FUELOS','WEBHOOK','MANUAL','CASHHUB_AMAZON','CASHHUB_HOTEL'));

-- 2) ตารางแมปช่องทางโรงแรม → บัญชีที่เงินเข้า (mirror cashhub_amazon_channel_config)
CREATE TABLE IF NOT EXISTS public.cashhub_hotel_channel_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  channel         varchar(20) NOT NULL,            -- 'qr' | 'cash' | 'ota_agoda' | 'ota_expedia' | 'ota_booking'
  label           varchar(60),
  is_settle       boolean NOT NULL DEFAULT true,   -- เป็นเงินเข้าธนาคารจริงไหม
  fee_percent     numeric(7,4) NOT NULL DEFAULT 0, -- ค่าคอม OTA (% หัก) — pilot=0
  bank_account_id uuid,                            -- บัญชีที่เงินเข้า (FK ledger_bank_account)
  company_id      uuid,                            -- บริษัทที่เงินเข้า (สำหรับ reconcile)
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel)
);
CREATE INDEX IF NOT EXISTS cashhub_hotel_channel_config_org_idx
  ON public.cashhub_hotel_channel_config (org_id);
ALTER TABLE public.cashhub_hotel_channel_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cashhub_hotel_channel_config' AND policyname = 'cashhub_hotel_channel_config_org_policy'
  ) THEN
    CREATE POLICY cashhub_hotel_channel_config_org_policy
      ON public.cashhub_hotel_channel_config FOR ALL
      TO authenticated
      USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
      WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
  END IF;
END $$;

-- 3) seed pilot (CEO 2026-06-14 ยืนยัน): QR→TTB 610286-3468 · เงินสด→BBL 594-0-933335 (ทั้งคู่ JP Sync Group)
--    resolve bank_account_id จาก account_no (กัน id แตกต่างข้าม env). OTA ยังไม่ seed (CEO รอตรวจสอบ).
INSERT INTO public.cashhub_hotel_channel_config (org_id, channel, label, is_settle, fee_percent, bank_account_id, company_id, active)
VALUES
  ('00000000-0000-0000-0000-000000000001','qr','QR (TTB smart shop 3468)', true, 0,
   (SELECT id FROM public.ledger_bank_account WHERE org_id='00000000-0000-0000-0000-000000000001'::uuid AND account_no='610286-3468' LIMIT 1),
   '00000000-0000-0000-0000-0000000000a2'::uuid, true),
  ('00000000-0000-0000-0000-000000000001','cash','เงินสดฝาก (BBL 933335)', true, 0,
   (SELECT id FROM public.ledger_bank_account WHERE org_id='00000000-0000-0000-0000-000000000001'::uuid AND account_no='594-0-933335' LIMIT 1),
   '00000000-0000-0000-0000-0000000000a2'::uuid, true)
ON CONFLICT (org_id, channel) DO NOTHING;

COMMENT ON TABLE public.cashhub_hotel_channel_config IS 'แมปช่องทางโรงแรม (qr/cash/ota) → บัญชีที่เงินเข้า สำหรับ reconcile';
