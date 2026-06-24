-- ClawFleet · คลังสินค้าเต็มระบบ (WMS) — ใบรับ / นับสต๊อก / ของหาย / ledger
-- Additive only · idempotent (IF NOT EXISTS / IF NOT EXISTS enum value) · apply to prod BEFORE deploy (schema-applied gate)
-- Fork of Playland stock pattern → public schema, org+branch scoped, Cf prefix
-- 2026-06-24

-- ─────────────────────────────────────────────────────────────
-- 1) ENUM extensions — CfStockMoveType + new CfLossReason
--    NOTE: ALTER TYPE ADD VALUE ต้องอยู่นอก transaction block (autocommit)
-- ─────────────────────────────────────────────────────────────
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'RECEIPT_IN';
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'COUNT_ADJUST';
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'WITHDRAW';
ALTER TYPE "public"."CfStockMoveType" ADD VALUE IF NOT EXISTS 'LOSS_ADJUST';

DO $$ BEGIN
  CREATE TYPE "public"."CfLossReason" AS ENUM ('DAMAGE', 'THEFT', 'OBSOLETE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- 2) COLUMN additions on existing tables
-- ─────────────────────────────────────────────────────────────
-- cf_products.barcode (บาร์โค้ด · unique ต่อ org)
ALTER TABLE "public"."cf_products" ADD COLUMN IF NOT EXISTS "barcode" text;
CREATE UNIQUE INDEX IF NOT EXISTS "cf_products_org_id_barcode_key" ON "public"."cf_products" ("org_id", "barcode");

-- cf_stock_movements: photo_urls + document link
ALTER TABLE "public"."cf_stock_movements" ADD COLUMN IF NOT EXISTS "photo_urls"    text[] NOT NULL DEFAULT '{}';
ALTER TABLE "public"."cf_stock_movements" ADD COLUMN IF NOT EXISTS "document_id"   uuid;
ALTER TABLE "public"."cf_stock_movements" ADD COLUMN IF NOT EXISTS "document_type" text;

-- ─────────────────────────────────────────────────────────────
-- 3) cf_goods_receipts (รับของเข้า · goods receipt)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cf_goods_receipts" (
  "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"           uuid        NOT NULL,
  "branch_id"        uuid        NOT NULL,
  "receipt_code"     text        NOT NULL,
  "supplier_name"    text,
  "note"             text,
  "total_cost_cents" integer     NOT NULL DEFAULT 0,
  "status"           text        NOT NULL DEFAULT 'RECEIVED',
  "photo_urls"       text[]      NOT NULL DEFAULT '{}',
  "created_by_id"    uuid        NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_goods_receipts_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_goods_receipts"
    ADD CONSTRAINT "cf_goods_receipts_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_goods_receipts"
    ADD CONSTRAINT "cf_goods_receipts_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_goods_receipts"
    ADD CONSTRAINT "cf_goods_receipts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "cf_goods_receipts_org_id_receipt_code_key" ON "public"."cf_goods_receipts" ("org_id", "receipt_code");
CREATE INDEX IF NOT EXISTS "cf_goods_receipts_org_id_branch_id_created_at_idx" ON "public"."cf_goods_receipts" ("org_id", "branch_id", "created_at" DESC);

-- cf_goods_receipt_lines
CREATE TABLE IF NOT EXISTS "public"."cf_goods_receipt_lines" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"          uuid        NOT NULL,
  "receipt_id"      uuid        NOT NULL,
  "product_id"      uuid        NOT NULL,
  "product_name"    text        NOT NULL,
  "quantity"        integer     NOT NULL,
  "unit_cost_cents" integer     NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_goods_receipt_lines"
    ADD CONSTRAINT "cf_goods_receipt_lines_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "public"."cf_goods_receipts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_goods_receipt_lines"
    ADD CONSTRAINT "cf_goods_receipt_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."cf_products"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cf_goods_receipt_lines_receipt_id_idx" ON "public"."cf_goods_receipt_lines" ("receipt_id");
CREATE INDEX IF NOT EXISTS "cf_goods_receipt_lines_product_id_idx" ON "public"."cf_goods_receipt_lines" ("product_id");

-- ─────────────────────────────────────────────────────────────
-- 4) cf_stock_counts (นับสต๊อกเป็นรอบ · cycle count)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cf_stock_counts" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"          uuid        NOT NULL,
  "branch_id"       uuid        NOT NULL,
  "count_code"      text        NOT NULL,
  "note"            text,
  "items_counted"   integer     NOT NULL DEFAULT 0,
  "total_diff"      integer     NOT NULL DEFAULT 0,
  "counted_by_id"   uuid        NOT NULL,
  "counted_by_name" text,
  "counted_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_stock_counts_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_stock_counts"
    ADD CONSTRAINT "cf_stock_counts_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_stock_counts"
    ADD CONSTRAINT "cf_stock_counts_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_stock_counts"
    ADD CONSTRAINT "cf_stock_counts_counted_by_id_fkey"
    FOREIGN KEY ("counted_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "cf_stock_counts_org_id_count_code_key" ON "public"."cf_stock_counts" ("org_id", "count_code");
CREATE INDEX IF NOT EXISTS "cf_stock_counts_org_id_branch_id_counted_at_idx" ON "public"."cf_stock_counts" ("org_id", "branch_id", "counted_at" DESC);

-- cf_stock_count_lines
CREATE TABLE IF NOT EXISTS "public"."cf_stock_count_lines" (
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
  CONSTRAINT "cf_stock_count_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_stock_count_lines"
    ADD CONSTRAINT "cf_stock_count_lines_count_id_fkey"
    FOREIGN KEY ("count_id") REFERENCES "public"."cf_stock_counts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_stock_count_lines"
    ADD CONSTRAINT "cf_stock_count_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."cf_products"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cf_stock_count_lines_count_id_idx" ON "public"."cf_stock_count_lines" ("count_id");
CREATE INDEX IF NOT EXISTS "cf_stock_count_lines_product_id_idx" ON "public"."cf_stock_count_lines" ("product_id");

-- ─────────────────────────────────────────────────────────────
-- 5) cf_loss_docs (ของหาย/เสียหาย/ตัดทิ้ง · loss/write-off)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cf_loss_docs" (
  "id"               uuid                  NOT NULL DEFAULT gen_random_uuid(),
  "org_id"           uuid                  NOT NULL,
  "branch_id"        uuid                  NOT NULL,
  "loss_code"        text                  NOT NULL,
  "reason"           "public"."CfLossReason" NOT NULL DEFAULT 'DAMAGE',
  "note"             text,
  "total_cost_cents" integer               NOT NULL DEFAULT 0,
  "photo_urls"       text[]                NOT NULL DEFAULT '{}',
  "reported_by_id"   uuid                  NOT NULL,
  "reported_at"      timestamptz           NOT NULL DEFAULT now(),
  CONSTRAINT "cf_loss_docs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_loss_docs"
    ADD CONSTRAINT "cf_loss_docs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_loss_docs"
    ADD CONSTRAINT "cf_loss_docs_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_loss_docs"
    ADD CONSTRAINT "cf_loss_docs_reported_by_id_fkey"
    FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "cf_loss_docs_org_id_loss_code_key" ON "public"."cf_loss_docs" ("org_id", "loss_code");
CREATE INDEX IF NOT EXISTS "cf_loss_docs_org_id_branch_id_reported_at_idx" ON "public"."cf_loss_docs" ("org_id", "branch_id", "reported_at" DESC);

-- cf_loss_lines
CREATE TABLE IF NOT EXISTS "public"."cf_loss_lines" (
  "id"              uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"          uuid        NOT NULL,
  "loss_id"         uuid        NOT NULL,
  "product_id"      uuid        NOT NULL,
  "product_name"    text        NOT NULL,
  "qty"             integer     NOT NULL,
  "unit_cost_cents" integer     NOT NULL DEFAULT 0,
  "note"            text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_loss_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_loss_lines"
    ADD CONSTRAINT "cf_loss_lines_loss_id_fkey"
    FOREIGN KEY ("loss_id") REFERENCES "public"."cf_loss_docs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_loss_lines"
    ADD CONSTRAINT "cf_loss_lines_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."cf_products"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cf_loss_lines_loss_id_idx" ON "public"."cf_loss_lines" ("loss_id");
CREATE INDEX IF NOT EXISTS "cf_loss_lines_product_id_idx" ON "public"."cf_loss_lines" ("product_id");
