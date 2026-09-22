-- ChairOps · แม่บ้าน: เซลฟี่ยืนยันตัวตน + ผู้ติดต่อฉุกเฉินคนที่ 2 (CEO 2026-09-22)
-- ADDITIVE · nullable ทุกคอลัมน์ · ข้อมูลเดิมไม่กระทบ.
--
-- selfie_image_url  — รูปเซลฟี่ตอน onboarding (PDPA-sensitive ระดับเดียวกับรูปบัตร)
-- sensitive_consent_at — เวลาที่แม่บ้านติ๊กยินยอมให้เก็บข้อมูลอ่อนไหว (PDPA ม.26
--   ต้องขอแยกจาก consent สัญญาทั่วไป เพราะบัตร ปชช. ไทยมีช่องศาสนาติดมาด้วย)
-- emergency_contact_2 / emergency_phone_2 — ผู้ติดต่อฉุกเฉินคนที่สอง
--   (cardinality คงที่ 2 คน → คอลัมน์คู่ ไม่ต้องแยกตาราง)
ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS "selfie_image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "selfie_captured_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "sensitive_consent_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "emergency_contact_2" TEXT,
  ADD COLUMN IF NOT EXISTS "emergency_phone_2" TEXT;
