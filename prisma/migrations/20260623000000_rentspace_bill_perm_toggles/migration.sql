-- RentSpace: แยกสิทธิ์บิลเป็นสวิตช์เปิด-ปิดได้ (เฉพาะ super_admin ตั้งได้)
--   bill_edit_unlocked   (มีอยู่แล้ว) = อนุญาตแก้ไขบิล
--   bill_delete_unlocked (ใหม่)       = อนุญาตลบบิล        · default ปิด (ของอันตราย)
--   bill_issue_unlocked  (ใหม่)       = อนุญาตออกบิล/ใบแจ้งหนี้ · default เปิด (ไม่ให้เวิร์กโฟลว์เดิมพัง)
-- super_admin ทำได้ทั้ง 3 เสมอ ไม่สนสวิตช์ (บังคับในชั้นโค้ด).
ALTER TABLE "public"."rental_project"
  ADD COLUMN IF NOT EXISTS "bill_delete_unlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "bill_issue_unlocked" BOOLEAN NOT NULL DEFAULT true;
