-- CashHub Hotel — เก็บข้อมูล IV แยกจาก Sheet (CEO 2026-06-14: เก็บ 2 ชุด เทียบกันได้)
-- เพิ่ม source เข้า unique key → 1 (สาขา,วัน,กะ) มีได้ทั้งแถว sheet_import และ trcloud_iv
-- + iv_number/iv_status (traceability). ADDITIVE — ไม่กระทบ 60 แถว sheet เดิม.

ALTER TABLE public.cashhub_hotel_daily
  ADD COLUMN IF NOT EXISTS iv_number varchar(40),
  ADD COLUMN IF NOT EXISTS iv_status varchar(20);

-- unique เดิม (branch,date,shift) → เพิ่ม source เข้าไป (sheet กับ iv อยู่คู่กันได้)
ALTER TABLE public.cashhub_hotel_daily
  DROP CONSTRAINT IF EXISTS cashhub_hotel_daily_branch_id_sales_date_shift_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cashhub_hotel_daily'::regclass
      AND conname = 'cashhub_hotel_daily_branch_date_shift_source_key'
  ) THEN
    ALTER TABLE public.cashhub_hotel_daily
      ADD CONSTRAINT cashhub_hotel_daily_branch_date_shift_source_key
      UNIQUE (branch_id, sales_date, shift, source);
  END IF;
END $$;
