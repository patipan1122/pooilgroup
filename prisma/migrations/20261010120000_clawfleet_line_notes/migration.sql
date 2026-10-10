-- ClawFleet · โน้ตรายบรรทัด (per-line note) บนรายการสินค้าแต่ละ SKU ในเอกสารหลายรายการ
-- (CEO 2026-10-10) — ปัจจุบันมีแค่โน้ตระดับ "ทั้งใบ" (เช่น cf_goods_receipts.note)
-- แต่พนักงานอยากจดเฉพาะ SKU หนึ่งในใบที่มีหลายรายการ (เช่น "กล่องนี้เปียก", "นับแยกจากล็อตเก่า")
--
-- ครอบคลุม 3 ตารางรายบรรทัด ที่ยืนยันแล้วว่าอยู่ใน Postgres/Prisma schema เดียวกัน (ไม่ใช่ระบบแยก):
--   • public.cf_goods_receipt_lines — รายการในใบ "รับของเข้า" (goods receipt)
--   • public.cf_delivery_lines      — รายการในใบ "กระจายสินค้า" (shipment/delivery)
--   • dc.transfer_lines             — รายการในใบ "โอนสินค้า DC" (transfer)
--
-- ADDITIVE เท่านั้น · เพิ่มคอลัมน์ nullable ทั้งหมด · IF NOT EXISTS = ปลอดภัย ไม่กระทบแถวเดิม
-- (null = พฤติกรรมเดิมทุกอย่าง ไม่มีใครเคยกรอกโน้ตรายบรรทัดมาก่อน)
ALTER TABLE public.cf_goods_receipt_lines
  ADD COLUMN IF NOT EXISTS "note" TEXT;

ALTER TABLE public.cf_delivery_lines
  ADD COLUMN IF NOT EXISTS "note" TEXT;

ALTER TABLE dc.transfer_lines
  ADD COLUMN IF NOT EXISTS "note" TEXT;
