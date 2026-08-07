-- CashHub Hotel — auto-sync config: ผูก "ชีต Google สาธารณะ" กับสาขาโรงแรม + จำสถานะซิงค์ล่าสุด
--
-- WHY: เดิมต้องโหลดชีตเป็นไฟล์ Excel แล้วอัปโหลดมือทุกครั้ง (source='xlsx_import').
--   CEO 2026-08-06: อยากให้ "ซิงค์ตลอด" อัตโนมัติ → เก็บ sheet id ต่อสาขา + เวลาซิงค์ล่าสุด
--   (กันดึงชีตถี่เกิน + โชว์ "อัปเดตล่าสุด" บนหน้า). ชีตเปิดสาธารณะ อ่านอย่างเดียว → ไม่มี secret.
--
-- เงินไม่เกี่ยว: ตารางนี้เก็บแค่ config + สถานะ. ยอดขายจริงยังลง cashhub_hotel_daily เหมือนเดิม.
-- ADDITIVE + idempotent — ตารางใหม่ทั้งหมด, ไม่แตะของเดิม.

CREATE TABLE IF NOT EXISTS public.cashhub_hotel_sheet_config (
  branch_id       uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  sheet_id        text NOT NULL,             -- Google Sheet file id (public, read-only)
  auto_sync       boolean NOT NULL DEFAULT true,
  last_synced_at  timestamptz,
  last_status     varchar(10),               -- 'ok' | 'warn' | 'error'
  last_message    text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cashhub_hotel_sheet_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cashhub_hotel_sheet_config'
      AND policyname = 'cashhub_hotel_sheet_config_org_policy'
  ) THEN
    CREATE POLICY cashhub_hotel_sheet_config_org_policy
      ON public.cashhub_hotel_sheet_config FOR ALL
      TO authenticated
      USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
      WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
  END IF;
END $$;

-- seed: ผูกชีตยอดขายโรงแรม (public) กับสาขาโรงแรมที่มีอยู่จริง (match ด้วย business_type
-- ไม่ hardcode UUID — กันกรณี branch id จริงบน prod ไม่ตรง seed) · 1 โรงแรม = ตรงตัว
INSERT INTO public.cashhub_hotel_sheet_config (branch_id, org_id, company_id, sheet_id)
SELECT b.id, b.org_id, b.company_id, '1Ft2WvYTJwFLaSar7CBEU7_GJxQzi0yWE2jBfah_ADZ0'
FROM public.branches b
WHERE b.business_type = 'hotel' AND b.is_active = true
ON CONFLICT (branch_id) DO NOTHING;

COMMENT ON TABLE public.cashhub_hotel_sheet_config IS
  'ผูกชีต Google (public) กับสาขาโรงแรม + สถานะ auto-sync ล่าสุด (CashHub Hotel realtime)';
