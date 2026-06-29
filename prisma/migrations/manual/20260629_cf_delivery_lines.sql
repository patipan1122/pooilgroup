-- ClawFleet · ตู้คีบ OS — รายการสินค้าในใบกระจาย (cf_delivery_lines)
-- Additive only · idempotent (IF NOT EXISTS / duplicate_object guard) · apply to prod BEFORE deploy (schema-applied gate)
-- ใบกระจายจากคลังกลาง → สาขา ตอนนี้มี "รายการสินค้า" จริง (สินค้า + จำนวนส่ง + จำนวนรับจริง)
-- snapshot product_name เผื่อสินค้าถูกแก้ชื่อ/ลบแล้วประวัติยังอ่านได้.
-- 2026-06-29

-- ─────────────────────────────────────────────────────────────
-- cf_delivery_lines
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cf_delivery_lines" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"       uuid        NOT NULL,
  "delivery_id"  uuid        NOT NULL,
  "product_id"   uuid        NOT NULL,
  "product_name" text        NOT NULL,
  "qty"          integer     NOT NULL,
  "received_qty" integer     NOT NULL DEFAULT 0,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_delivery_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_delivery_lines"
    ADD CONSTRAINT "cf_delivery_lines_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_delivery_lines"
    ADD CONSTRAINT "cf_delivery_lines_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "public"."cf_deliveries"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_delivery_lines"
    ADD CONSTRAINT "cf_delivery_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."cf_products"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cf_delivery_lines_delivery_id_idx" ON "public"."cf_delivery_lines" ("delivery_id");
CREATE INDEX IF NOT EXISTS "cf_delivery_lines_product_id_idx" ON "public"."cf_delivery_lines" ("product_id");
