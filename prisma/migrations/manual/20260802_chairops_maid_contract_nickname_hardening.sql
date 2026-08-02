-- F4b · แม่บ้าน: ชื่อเล่น + ทำสัญญาให้แน่นทางกฎหมาย (CEO 2026-08-02)
--
-- (1) ChairopsUser.nickname — ชื่อเล่น (ใช้ในฟอร์มสร้างสัญญาฝั่งออฟฟิศ + ตารางแม่บ้าน)
-- (2) ChairopsMaidContract — เพิ่มหลักฐานการลงนามอิเล็กทรอนิกส์ให้แข็งแรงตาม
--     พ.ร.บ. ธุรกรรมทางอิเล็กทรอนิกส์ ม.9: บันทึก user-agent + content hash
--     (SHA-256 ของเนื้อหาสัญญาที่เซ็น → กันแก้ย้อนหลัง / พิสูจน์ในศาลได้).
-- Idempotent (ADD COLUMN IF NOT EXISTS) — รันซ้ำได้. ตารางอยู่ schema `chairops`.

-- (1) ชื่อเล่นบน ChairopsUser
ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS nickname text NULL;

-- (2) หลักฐานการลงนาม (camelCase · double-quoted ตาม convention ของตารางนี้)
ALTER TABLE chairops."ChairopsMaidContract"
  ADD COLUMN IF NOT EXISTS "signedUserAgent" text NULL;
ALTER TABLE chairops."ChairopsMaidContract"
  ADD COLUMN IF NOT EXISTS "contentHash" text NULL;
