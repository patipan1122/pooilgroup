-- Playland · เพิ่ม "ตำแหน่ง" ต่อพนักงาน (สิทธิ์เฉพาะ Playland · แยกจาก role ระบบ) — ADDITIVE ปลอดภัย
-- position: owner | manager | cashier (null = ใช้ role ระบบเดิม fallback)
ALTER TABLE "playland"."staff_branches" ADD COLUMN IF NOT EXISTS "position" text;
