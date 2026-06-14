-- CashHub Hotel — เก็บ "แถบเวลา" ของ QR จากไฟล์ TTB เพื่อคิดยอด "ฐานกะ" (CEO 2026-06-14)
--
-- WHY: ยอด QR ที่พนักงานคีย์ (IV) = นับตามกะ (กะดึก 18:00–07:00 คร่อมเที่ยงคืน).
--   แต่ธนาคารตัดยอดตามวันปฏิทิน (23:00) → ต้นเดือน/ปลายเดือนยอด QR ช่วง 00:00–07:00
--   ตกไปคนละเดือน → IV (128,500) ≠ ธนาคาร (127,735) ต่าง 765 = ยอดกะดึกคร่อมเดือนล้วน ๆ.
--   เก็บ "ยอดสแกนรวมทั้งวัน" + "ยอดช่วง 00:00–07:00" ต่อวันปฏิทิน → คิด "ฐานกะ" ตอนอ่าน:
--     ฐานกะ(วัน N) = สแกนรวม(N) − ดึก(N) + ดึก(N+1)   ← ตรงกับที่พนักงานคีย์
--   qr_banked เดิม (ตัด 23:00) คงไว้ = ยอดเข้าบัญชีจริงตาม statement ธนาคาร.
-- ADDITIVE + idempotent — เพิ่ม 2 คอลัมน์ ไม่แตะของเดิม.

ALTER TABLE public.cashhub_hotel_daily
  ADD COLUMN IF NOT EXISTS qr_scan_total numeric(15,2),  -- TTB: ยอด QR สแกนรวมทั้งวัน (ตามวันสแกนจริง)
  ADD COLUMN IF NOT EXISTS qr_overnight  numeric(15,2);  -- TTB: ยอด QR สแกนช่วง 00:00–07:00 (= กะคืนของวันก่อน)

COMMENT ON COLUMN public.cashhub_hotel_daily.qr_scan_total IS 'TTB QR สแกนรวมทั้งวัน (ตามวันสแกน) — ใช้คิดฐานกะ';
COMMENT ON COLUMN public.cashhub_hotel_daily.qr_overnight IS 'TTB QR สแกน 00:00–07:00 (เป็นของกะคืนวันก่อน) — ใช้คิดฐานกะ';
