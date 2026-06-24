-- Playland · Stock + Barcode system (2026-06-24)
-- Additive only · idempotent · safe to re-run
-- 2 enums + 2 product columns + 4 tables + indexes + FKs

-- ── Enums ──
DO $$ BEGIN
  CREATE TYPE "playland"."PlaylandProductKind" AS ENUM ('SALE_ITEM', 'SPARE_PART');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "playland"."PlaylandStockMoveKind" AS ENUM ('PURCHASE_IN', 'SALE_OUT', 'COUNT_ADJUST', 'PART_USED', 'RETURN_IN', 'MANUAL_ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── products: kind + supplier ──
ALTER TABLE "playland"."products" ADD COLUMN IF NOT EXISTS "kind" "playland"."PlaylandProductKind" NOT NULL DEFAULT 'SALE_ITEM';
ALTER TABLE "playland"."products" ADD COLUMN IF NOT EXISTS "supplier" TEXT;

-- ── stock_movements (ledger) ──
CREATE TABLE IF NOT EXISTS "playland"."stock_movements" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "playland"."PlaylandStockMoveKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "balance_after" INTEGER,
    "ref_type" TEXT,
    "ref_id" UUID,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- ── purchases (goods receipt) ──
CREATE TABLE IF NOT EXISTS "playland"."purchases" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "purchase_code" TEXT NOT NULL,
    "supplier_name" TEXT,
    "total_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "playland"."purchase_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- ── repair_logs + repair_parts (ซ่อมเครื่อง · เบิกอะไหล่) ──
CREATE TABLE IF NOT EXISTS "playland"."repair_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "repair_code" TEXT NOT NULL,
    "machine_label" TEXT NOT NULL,
    "description" TEXT,
    "parts_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repair_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "playland"."repair_parts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "repair_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repair_parts_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS "products_branch_id_kind_active_idx" ON "playland"."products"("branch_id", "kind", "active");
CREATE INDEX IF NOT EXISTS "stock_movements_org_id_branch_id_idx" ON "playland"."stock_movements"("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "stock_movements_product_id_created_at_idx" ON "playland"."stock_movements"("product_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_movements_branch_id_kind_created_at_idx" ON "playland"."stock_movements"("branch_id", "kind", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "purchases_purchase_code_key" ON "playland"."purchases"("purchase_code");
CREATE INDEX IF NOT EXISTS "purchases_org_id_branch_id_idx" ON "playland"."purchases"("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "purchases_branch_id_created_at_idx" ON "playland"."purchases"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "purchase_lines_purchase_id_idx" ON "playland"."purchase_lines"("purchase_id");
CREATE INDEX IF NOT EXISTS "purchase_lines_product_id_idx" ON "playland"."purchase_lines"("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "repair_logs_repair_code_key" ON "playland"."repair_logs"("repair_code");
CREATE INDEX IF NOT EXISTS "repair_logs_org_id_branch_id_idx" ON "playland"."repair_logs"("org_id", "branch_id");
CREATE INDEX IF NOT EXISTS "repair_logs_branch_id_created_at_idx" ON "playland"."repair_logs"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "repair_parts_repair_id_idx" ON "playland"."repair_parts"("repair_id");
CREATE INDEX IF NOT EXISTS "repair_parts_product_id_idx" ON "playland"."repair_parts"("product_id");

-- ── Foreign keys (guarded · idempotent) ──
DO $$ BEGIN
  ALTER TABLE "playland"."stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "playland"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."purchases" ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "playland"."purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "playland"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."repair_logs" ADD CONSTRAINT "repair_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."repair_parts" ADD CONSTRAINT "repair_parts_repair_id_fkey" FOREIGN KEY ("repair_id") REFERENCES "playland"."repair_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "playland"."repair_parts" ADD CONSTRAINT "repair_parts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "playland"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
