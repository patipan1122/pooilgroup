-- ChairOps · ฝากเงิน: บันทึก "ตำแหน่งคนฝาก" เพื่อแยก แม่บ้านฝาก vs แอดมิน/ออฟฟิศฝาก
-- (CEO 2026-06-29 · ตรวจยอดรายตู้-รายวัน)
--
-- maidId เก็บ id ของ "คนที่กดปุ่มฝาก" อยู่แล้ว (ทั้ง flow แม่บ้านและ flow ออฟฟิศ
-- pin maidId = session.user.id) → เพิ่มแค่ snapshot ตำแหน่ง ณ ตอนฝาก 1 คอลัมน์
-- ก็แยกได้ ไม่ต้องเพิ่ม relation ใหม่. ADDITIVE · nullable · ของเดิมไม่กระทบ.
--
-- 1) เพิ่มคอลัมน์ (idempotent)
ALTER TABLE chairops."ChairopsCashDeposit"
  ADD COLUMN IF NOT EXISTS "depositedByRole" TEXT;

-- 2) Backfill ของเก่า: ดึงตำแหน่ง "ปัจจุบัน" ของคนฝาก (maidId) มาเติม
--    (ถ้าคนนั้นเคยเปลี่ยนตำแหน่ง รายการเก่าจะติดตามตำแหน่งปัจจุบัน — เกิดน้อยมาก)
UPDATE chairops."ChairopsCashDeposit" d
SET "depositedByRole" = u."role"::text
FROM chairops."ChairopsUser" u
WHERE d."maidId" = u."id"
  AND d."depositedByRole" IS NULL;
