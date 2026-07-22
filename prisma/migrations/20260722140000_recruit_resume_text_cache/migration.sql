-- Recruit AI ค้นหา: แคชเนื้อหา resume ที่ AI แกะแล้ว เพื่อไม่ต้องอ่าน PDF ใหม่ทุกครั้งที่ค้นหา
-- additive · idempotent · nullable (forward-only · ไม่กระทบข้อมูลเดิม)
ALTER TABLE "recruit_applications" ADD COLUMN IF NOT EXISTS "resume_text" TEXT;
ALTER TABLE "recruit_applications" ADD COLUMN IF NOT EXISTS "resume_text_at" TIMESTAMPTZ(6);
