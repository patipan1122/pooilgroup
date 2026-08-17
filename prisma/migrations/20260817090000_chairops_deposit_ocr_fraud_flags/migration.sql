-- ChairOps · AI อ่านสลิปธนาคาร (ยอด/วันที่/ชื่อบัญชี) + เหตุผล auto-flag
-- (CEO 2026-08-17 · ตรวจสลิปซ้ำ + บัญชีปลายทางไม่ตรง ป้องกันโกง)
--
-- ADDITIVE · nullable ทั้งหมด · ของเดิมไม่กระทบ. อ่านครั้งเดียวตอนฝากใหม่ ไม่มี
-- backfill สลิปเก่า (แสดงผลจะ fallback ไปใช้ depositedAmount แทนสำหรับของเก่า).
ALTER TABLE chairops."ChairopsCashDeposit"
  ADD COLUMN IF NOT EXISTS "ocrAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "ocrDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ocrAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "ocrReadAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ocrFlagReason" TEXT;
