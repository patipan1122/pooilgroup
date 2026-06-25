-- ChairOps · ใบตัดเงินขาด/เกิน "ตั้งต้นใหม่ ณ วันที่" (CEO 2026-06-25)
-- ------------------------------------------------------------------
-- เพิ่ม 2 ช่องในตารางตัดเงิน:
--   effectiveDate = "ตั้งต้น ณ วันที่" — ใบตัดนี้ปิดยอดหาย/เกินสะสม "ถึงวันนี้"
--   direction     = ทิศของยอด · SHORT = เงินขาด (ค้างฝาก) · OVER = เงินเกิน (ฝากเกิน)
--
-- amount เก็บเป็นค่าบวกเสมอ (magnitude) · ทิศอยู่ที่ direction
-- legacy rows ทั้งหมดเป็นเงินขาด → backfill direction = SHORT, effectiveDate = วันที่ขอ (makerAt)
-- Idempotent: ใช้ IF NOT EXISTS · รันซ้ำได้ไม่พัง

ALTER TABLE "chairops"."ChairopsWriteOff"
  ADD COLUMN IF NOT EXISTS "direction"     TEXT NOT NULL DEFAULT 'SHORT',
  ADD COLUMN IF NOT EXISTS "effectiveDate" DATE;

-- Backfill: ใบเก่าทั้งหมด ถือว่า "ตั้งต้น" ณ วันที่ขอ (Bangkok day grain)
UPDATE "chairops"."ChairopsWriteOff"
   SET "effectiveDate" = (("makerAt" AT TIME ZONE 'Asia/Bangkok'))::date
 WHERE "effectiveDate" IS NULL;
