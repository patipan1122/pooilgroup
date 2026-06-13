-- CashHub — Hotel daily sales + verification (Mix Hotel pilot)
-- ที่เก็บยอดขายโรงแรมรายวัน/กะ สำหรับหน้า "บริหาร+ตรวจสอบยอดขายโรงแรม" (/cashhub/hotel)
--
-- WHY แยกตารางใหม่ (ไม่ใช้ daily_reports เดิม): โรงแรมต้องเก็บ "ยอดที่บันทึก ↔ ยอดเข้าบัญชีจริง
--   ↔ ส่วนต่าง" ต่อช่องทาง (QR/OTA) เพื่อ "ตรวจสอบ" — daily_reports เก็บได้แค่ค่าเดียว/ช่องทาง
--   จึงแคบเกินไป. ตารางนี้สะท้อนชีต Google รายวันของโรงแรมแบบครบทุกช่อง (read-only ในระบบ —
--   ชีตยังเป็นเจ้าของข้อมูล · แก้ในชีตแล้วนำเข้าใหม่).
--
-- หน่วยเงินสด = "รอบส่งเงิน" (กะดึก 18:00–07:00 + กะเช้า 07:00–18:00 เก็บ ~10 โมง) ค่าระดับวัน
--   (รวมเงินสด/เข้าบัญชี/ส่วนต่าง) ลงที่แถวกะเช้า · ค่าระดับกะ (ยอดขาย/QR กะ) ลงตามกะ.
-- ADDITIVE + idempotent — ตารางใหม่ทั้งหมด, ไม่แตะของเดิม.

-- ============================================================
-- 1. seed สาขา "โรงแรม Mix" (JP Sync Group) ถ้ายังไม่มี
-- ============================================================
INSERT INTO public.branches
  (id, org_id, company_id, code, name, business_type, province, report_deadline, is_active, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a2',
   'JPS-HOTEL-01', 'โรงแรม Mix', 'hotel', 'นครราชสีมา', '11:00', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. cashhub_hotel_daily — ยอดขายรายวัน/กะ ครบทุกช่อง
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cashhub_hotel_daily (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  sales_date      date NOT NULL,
  shift           varchar(10) NOT NULL CHECK (shift IN ('morning','evening')),

  -- ── ยอดขาย (per shift) ────────────────────────────────
  rooms           integer,                 -- จำนวนห้องที่ขาย
  room_revenue    numeric(15,2),           -- ค่าห้อง (เงินสด)
  fine            numeric(15,2),           -- ค่าปรับ
  tip             numeric(15,2),           -- ทิป (รวมในเงินสดที่ส่ง)
  goods_sales     numeric(15,2),           -- ขายขนม/น้ำ/ของ (สินค้าเพื่อขาย)
  total_sales     numeric(15,2),           -- = room+fine+tip+goods

  -- ── เงินสด (รอบส่งเงิน — ค่าระดับวันลงแถวเช้า) ─────────
  cash_to_remit   numeric(15,2),           -- ยอดส่งเงินสด = ยอดขายรวม − (QR+OTA)
  cash_pool       numeric(15,2),           -- รวมเงินสด (ก้อนที่เก็บ ~10 โมง)
  cash_deposited  numeric(15,2),           -- เงินสดส่ง (ฝากจริง)
  cash_diff       numeric(15,2),           -- ส่วนต่างเงินสด
  advance         numeric(15,2),           -- ของล่วงหน้า

  -- ── QR / เงินโอน ──────────────────────────────────────
  qr_morning      numeric(15,2),           -- QR เช้า (ก่อน 23:30)
  qr_after2330    numeric(15,2),           -- QR หลัง 23:30
  qr_total        numeric(15,2),           -- ยอดรวม QR (วัน)
  qr_banked       numeric(15,2),           -- ยอดเข้าบัญชี (TTB 3468)
  qr_diff         numeric(15,2),           -- ส่วนต่าง QR = เข้าบัญชี − ยอดรวม (ควร 0)

  -- ── OTA (เก็บราย platform · แสดงรวมก้อนเดียวก่อน) ──────
  ota_agoda          numeric(15,2),        -- agoda ยอดลูกค้าจ่าย
  ota_agoda_banked   numeric(15,2),        -- agoda เงินเข้าจริง (BBL 3335)
  ota_expedia        numeric(15,2),
  ota_expedia_banked numeric(15,2),
  ota_booking        numeric(15,2),
  ota_booking_banked numeric(15,2),

  -- ── meta ──────────────────────────────────────────────
  staff_name      varchar(100),            -- คนเข้าเวร
  note            text,                    -- หมายเหตุภาษาคน
  over_short      numeric(15,2),           -- เงินเกิน/ขาด (ลิ้นชัก)
  raw_json        jsonb,                   -- เซลล์ดิบทั้งหมด (audit/ตรวจย้อน)

  source          varchar(40) NOT NULL DEFAULT 'sheet_import',
  imported_by     uuid,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, sales_date, shift)    -- idempotent: 1 แถว/สาขา/วัน/กะ
);

CREATE INDEX IF NOT EXISTS cashhub_hotel_daily_lookup_idx
  ON public.cashhub_hotel_daily (org_id, branch_id, sales_date);

ALTER TABLE public.cashhub_hotel_daily ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cashhub_hotel_daily' AND policyname = 'cashhub_hotel_daily_org_policy'
  ) THEN
    CREATE POLICY cashhub_hotel_daily_org_policy
      ON public.cashhub_hotel_daily FOR ALL
      TO authenticated
      USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
      WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
  END IF;
END $$;

-- ============================================================
-- 3. cashhub_hotel_month — cross-check ระดับเดือน (Sheet ↔ POS หน้าโรงแรม)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cashhub_hotel_month (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  company_id    uuid NOT NULL,
  branch_id     uuid NOT NULL,
  year          integer NOT NULL,
  month         integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  rooms_sheet   integer,                   -- จำนวนห้องตาม Sheet
  revenue_sheet numeric(15,2),             -- ยอดขาย(ห้อง) ตาม Sheet
  rooms_pos     integer,                   -- จำนวนห้องตาม POS คอมหน้าโรงแรม
  revenue_pos   numeric(15,2),             -- ยอดขายตาม POS
  goods_sales   numeric(15,2),             -- ยอดขายสินค้าเพื่อขาย (เดือน)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year, month)
);

ALTER TABLE public.cashhub_hotel_month ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cashhub_hotel_month' AND policyname = 'cashhub_hotel_month_org_policy'
  ) THEN
    CREATE POLICY cashhub_hotel_month_org_policy
      ON public.cashhub_hotel_month FOR ALL
      TO authenticated
      USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
      WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
  END IF;
END $$;

COMMENT ON TABLE public.cashhub_hotel_daily IS 'ยอดขายโรงแรมรายวัน/กะ + ตรวจสอบ QR/OTA/เงินสด (นำเข้าจากชีต · read-only)';
COMMENT ON TABLE public.cashhub_hotel_month IS 'cross-check เดือน: Sheet ↔ POS หน้าโรงแรม';
