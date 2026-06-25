-- Playland · คลื่น 1 ความปลอดภัย/กฎหมายเด็ก — 3 ตารางใหม่ (additive · idempotent)
--   incidents      = บันทึกอุบัติเหตุ/เหตุการณ์เด็ก (กันคดี · เคลมประกัน)
--   safety_checks  = เช็กลิสต์ตรวจเครื่องเล่น/ทำความสะอาดรายวัน
--   lost_found     = ของหาย-ของเก็บได้
-- apply to prod BEFORE deploy (schema-applied gate) · 2026-06-25

-- ── บันทึกอุบัติเหตุ / เหตุการณ์ ──
CREATE TABLE IF NOT EXISTS "playland"."incidents" (
  "id"                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"               uuid        NOT NULL,
  "branch_id"            uuid        NOT NULL,
  "incident_code"        text        NOT NULL,
  "occurred_at"          timestamptz NOT NULL,
  "kind"                 text        NOT NULL,
  "severity"             text        NOT NULL DEFAULT 'minor',
  "child_name"           text,
  "member_id"            uuid,
  "location"             text,
  "description"          text        NOT NULL,
  "action_taken"         text,
  "parent_notified"      boolean     NOT NULL DEFAULT false,
  "photo_r2_paths"       text[]      NOT NULL DEFAULT '{}',
  "reported_by_user_id"  uuid        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "playland"."incidents"
    ADD CONSTRAINT "incidents_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_incident_code_key" ON "playland"."incidents" ("incident_code");
CREATE INDEX IF NOT EXISTS "incidents_org_id_branch_id_idx" ON "playland"."incidents" ("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "incidents_branch_id_occurred_at_idx" ON "playland"."incidents" ("branch_id", "occurred_at");

-- ── เช็กลิสต์ความปลอดภัย / ทำความสะอาดรายวัน ──
CREATE TABLE IF NOT EXISTS "playland"."safety_checks" (
  "id"                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"               uuid        NOT NULL,
  "branch_id"            uuid        NOT NULL,
  "check_code"           text        NOT NULL,
  "check_type"           text        NOT NULL,
  "shift_label"          text,
  "items_json"           jsonb       NOT NULL DEFAULT '[]',
  "all_pass"             boolean     NOT NULL DEFAULT true,
  "note"                 text,
  "checked_by_user_id"   uuid        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "safety_checks_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "playland"."safety_checks"
    ADD CONSTRAINT "safety_checks_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "safety_checks_check_code_key" ON "playland"."safety_checks" ("check_code");
CREATE INDEX IF NOT EXISTS "safety_checks_org_id_branch_id_idx" ON "playland"."safety_checks" ("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "safety_checks_branch_id_created_at_idx" ON "playland"."safety_checks" ("branch_id", "created_at");

-- ── ของหาย-ของเก็บได้ ──
CREATE TABLE IF NOT EXISTS "playland"."lost_found" (
  "id"                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"               uuid        NOT NULL,
  "branch_id"            uuid        NOT NULL,
  "item_code"            text        NOT NULL,
  "status"               text        NOT NULL DEFAULT 'stored',
  "item_name"            text        NOT NULL,
  "description"          text,
  "found_location"       text,
  "found_at"             timestamptz NOT NULL,
  "photo_r2_path"        text,
  "claimed_by_name"      text,
  "claimed_at"           timestamptz,
  "contact_phone"        text,
  "recorded_by_user_id"  uuid        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lost_found_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "playland"."lost_found"
    ADD CONSTRAINT "lost_found_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "lost_found_item_code_key" ON "playland"."lost_found" ("item_code");
CREATE INDEX IF NOT EXISTS "lost_found_org_id_branch_id_idx" ON "playland"."lost_found" ("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "lost_found_branch_id_status_idx" ON "playland"."lost_found" ("branch_id", "status");
