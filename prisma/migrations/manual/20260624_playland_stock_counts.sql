-- Playland · นับสต๊อกเป็นรอบ (cycle count rounds) — เก็บการนับเป็น "ใบ" ดูย้อนหลังได้
-- Additive only · idempotent (IF NOT EXISTS) · apply to prod BEFORE deploy (schema-applied gate)
-- 2026-06-24

-- ── ตารางหัวใบนับสต๊อก ──
CREATE TABLE IF NOT EXISTS "playland"."stock_counts" (
  "id"                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"             uuid        NOT NULL,
  "branch_id"          uuid        NOT NULL,
  "count_code"         text        NOT NULL,
  "note"               text,
  "items_counted"      integer     NOT NULL DEFAULT 0,
  "total_diff"         integer     NOT NULL DEFAULT 0,
  "counted_by_user_id" uuid        NOT NULL,
  "counted_by_name"    text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- FK → branches (cascade ตามแม่)
DO $$ BEGIN
  ALTER TABLE "playland"."stock_counts"
    ADD CONSTRAINT "stock_counts_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_counts_count_code_key" ON "playland"."stock_counts" ("count_code");
CREATE INDEX IF NOT EXISTS "stock_counts_org_id_branch_id_idx" ON "playland"."stock_counts" ("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "stock_counts_branch_id_created_at_idx" ON "playland"."stock_counts" ("branch_id", "created_at");

-- ── ตารางบรรทัดนับสต๊อก ──
CREATE TABLE IF NOT EXISTS "playland"."stock_count_lines" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"       uuid        NOT NULL,
  "count_id"     uuid        NOT NULL,
  "product_id"   uuid        NOT NULL,
  "product_name" text        NOT NULL,
  "system_qty"   integer     NOT NULL,
  "counted_qty"  integer     NOT NULL,
  "diff"         integer     NOT NULL,
  "reason"       text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "playland"."stock_count_lines"
    ADD CONSTRAINT "stock_count_lines_count_id_fkey"
    FOREIGN KEY ("count_id") REFERENCES "playland"."stock_counts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "playland"."stock_count_lines"
    ADD CONSTRAINT "stock_count_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "playland"."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "stock_count_lines_count_id_idx" ON "playland"."stock_count_lines" ("count_id");
CREATE INDEX IF NOT EXISTS "stock_count_lines_product_id_idx" ON "playland"."stock_count_lines" ("product_id");
