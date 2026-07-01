-- ClawOS · audit wave A (2026-07-01) — anti-cheat + race guards
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code.
-- (1) เพิ่มสถานะ CANCELLED (cron auto-close เก็บกวาดรอบว่าง 0 event · trigger ข้าม)
-- (2) B1 unique: กันกรอกตู้ซ้ำในรอบ (double-submit/retry race → นับเงิน+ตัดสต๊อก 2 เท่า)
-- (3) G1 unique: 1 OPEN session / สาขา (รอบ branch-flat) กัน 2 คนเปิดพร้อมกัน (denominator เพี้ยน)
-- ตรวจแล้ว prod ไม่มี dup COLLECTION / ไม่มี 2-open-branch → index สร้างได้สะอาด.

-- (1) enum value (PG12+ · idempotent · ต้อง commit แยกก่อนใช้ค่าใหม่ที่ runtime)
ALTER TYPE "public"."CfSessionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- (2) B1 · 1 COLLECTION event ต่อ (รอบ, ตู้)
CREATE UNIQUE INDEX IF NOT EXISTS "cf_events_one_collection_per_machine_session"
  ON "public"."cf_collection_events" ("session_id", "machine_id")
  WHERE "event_type" = 'COLLECTION';

-- (3) G1 · 1 OPEN session ต่อสาขา (เฉพาะรอบสาขา group_id IS NULL · รอบกลุ่มมี index ของตัวเองแล้ว)
CREATE UNIQUE INDEX IF NOT EXISTS "cf_sessions_one_open_per_branch"
  ON "public"."cf_collection_sessions" ("branch_id")
  WHERE "status" = 'OPEN' AND "group_id" IS NULL;
