-- ChairOps · แม่บ้านหลายสาขา — เก็บ "สาขาที่กำลังทำงาน" ลงฐานข้อมูล (server-authoritative).
-- แก้บั๊ก: cookie สาขาถูก LINE in-app browser ทิ้งเงียบ ๆ → กดสลับสาขาแล้วเด้งกลับสาขาเดิม
-- (แม่บ้านฝากเงินสาขาอื่นไม่ได้). ตอนนี้ getSession อ่านจาก DB ก่อน cookie (CEO 2026-07-13).
-- Additive · nullable · schema chairops. ปลอดภัยกับโค้ดเก่า (null = fallback cookie/home).
ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS active_branch_id text,
  ADD COLUMN IF NOT EXISTS active_branch_set_at timestamptz(6);
