-- CEO 2026-08-02 · ตรวจ/ยืนยัน "รายตู้" จากรายงานเจาะสาขา (matrix)
-- เพิ่ม reviewed_at / reviewed_by_id บน cf_collection_events (nullable ทั้งคู่)
--   → ช่องเงินขาด/เกิน = แดง · พอ admin ตรวจ/ยืนยัน = ฟ้า (reviewed_at มีค่า)
--   nullable + IF NOT EXISTS → เพิ่มได้ทันที ไม่กระทบข้อมูล/เงินเดิม · re-run ปลอดภัย
ALTER TABLE "public"."cf_collection_events"
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reviewed_by_id" UUID;
