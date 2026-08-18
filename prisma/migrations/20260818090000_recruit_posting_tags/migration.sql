-- Recruit · ประกาศรับสมัคร: เพิ่มแท็ก (CEO 2026-08-18)
-- ใช้ติดแท็กประกาศ (เช่น "Amazon") เพื่อกรองในหน้ารายการประกาศ
-- ADDITIVE · default เป็น array ว่าง · ประกาศเก่าไม่กระทบ
ALTER TABLE "recruit_job_postings"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
