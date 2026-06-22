-- RentSpace: "โหมดทดลอง" — สวิตช์อนุญาตให้แก้ไข/ลบบิลได้โดยตรง (ข้ามการขออนุมัติ)
-- คุมโดย super_admin ในหน้าตั้งค่า · default = ปิด (ปลอดภัยตอนใช้จริง)
-- additive · idempotent · ของเก่าไม่กระทบ
ALTER TABLE public.rental_project
  ADD COLUMN IF NOT EXISTS bill_edit_unlocked boolean NOT NULL DEFAULT false;
