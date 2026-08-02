-- ChairOps · เพิ่ม "ชื่อเล่น" ให้เก้าอี้ (CEO 2026-08-02 Pinpoint /chairops/branches)
-- Additive · nullable · schema chairops · ไม่กระทบเก้าอี้เดิม (ค่าเริ่มต้น = NULL → โชว์แต่รหัสเหมือนเดิม).
-- chairCode ยังเป็น key ที่ POS/ประวัติเก็บเงิน join อยู่ → ตั้ง/แก้ชื่อไม่กระทบเงิน.
ALTER TABLE chairops."ChairopsChair"
  ADD COLUMN IF NOT EXISTS "name" text;
