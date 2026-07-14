-- DC · ใบสั่งซื้อจีน — เพิ่ม 2 ช่องในหัวใบ
--   • title         : "ชื่อเรียกใบ" ที่ผู้ใช้ตั้งเอง (label) — หาใบง่ายกว่าเลข PO สุ่ม
--   • source_images : รูปต้นฉบับที่ AI สแกน — jsonb array ของ { driveUrl, driveFileId, r2Key }
--                     (best-effort เก็บลิงก์ Google Drive ไว้ย้อนตรวจ ถ้า AI อ่านผิด)
-- Additive · nullable · IF NOT EXISTS = ปลอดภัย ไม่กระทบใบเดิม (null = พฤติกรรมเดิมทุกอย่าง)
ALTER TABLE dc."purchase_orders"
  ADD COLUMN IF NOT EXISTS "title" text,
  ADD COLUMN IF NOT EXISTS "source_images" jsonb;
