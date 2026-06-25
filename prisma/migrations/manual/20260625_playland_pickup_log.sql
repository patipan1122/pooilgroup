-- Playland · คลื่น 2 — บันทึก "ใครมารับเด็ก" ตอนเช็กเอาท์ (log only · ไม่บล็อก · CEO 2026-06-25)
-- additive · idempotent · apply to prod BEFORE deploy
ALTER TABLE "playland"."sessions" ADD COLUMN IF NOT EXISTS "picked_up_by_member_id" uuid;
ALTER TABLE "playland"."sessions" ADD COLUMN IF NOT EXISTS "picked_up_by_name" text;
