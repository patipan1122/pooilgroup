-- ClawFleet · idempotency key เป็นคอลัมน์จริง (AUD 2026-07-19 · แก้ fake-safety marker-in-notes)
-- เดิม baseline ฝัง clientKey เป็น [BASELINE_KEY]<key> ใน notes → lookup ด้วย substring บน free-text (ไม่ index · ชนได้)
-- ย้ายมาเป็น client_key + partial unique index (org_id, client_key) → กันซ้ำที่ DB จริง.
-- additive · nullable · forward-only — แถวเก่า client_key = NULL (baseline once-per-machine ยังกันซ้ำด้วย unique เดิม)
ALTER TABLE "public"."cf_collection_events" ADD COLUMN IF NOT EXISTS "client_key" TEXT;

-- NULLS DISTINCT (default) → แถวเก่าที่ client_key NULL ไม่ชนกัน · เฉพาะ key ซ้ำจริงถึงบล็อก
CREATE UNIQUE INDEX IF NOT EXISTS "cf_collection_events_org_id_client_key_key"
  ON "public"."cf_collection_events"("org_id", "client_key");
