-- DC Warehouse migration (dc schema only) — 2026-06-24
-- Filtered from prisma migrate diff: drift DROP/ALTER on other schemas REMOVED.
-- Apply to prod with node+pg DIRECT_URL (CEO-approved). Idempotent-ish: CREATE SCHEMA IF NOT EXISTS.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "dc";

-- CreateEnum
CREATE TYPE "dc"."DcWarehouseRole" AS ENUM ('FLOOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "dc"."DcProductType" AS ENUM ('SALE', 'SPARE');

-- CreateEnum
CREATE TYPE "dc"."DcMoveKind" AS ENUM ('RECEIVE', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUST', 'MOVE', 'RETURN_IN');

-- CreateEnum
CREATE TYPE "dc"."DcPostStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'NA');

-- CreateEnum
CREATE TYPE "dc"."DcPoStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIAL', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "dc"."DcShipmentMode" AS ENUM ('TRUCK', 'SEA');

-- CreateEnum
CREATE TYPE "dc"."DcShipmentStatus" AS ENUM ('PREPARING', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "dc"."DcTransferStatus" AS ENUM ('DISPATCHED', 'IN_TRANSIT', 'CONFIRMED', 'AUTO_UNVERIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "dc"."DcTransferDestType" AS ENUM ('WAREHOUSE', 'MODULE');

-- CreateEnum
CREATE TYPE "dc"."DcOutboxStatus" AS ENUM ('PENDING', 'SENT', 'ACKED', 'FAILED');

-- CreateTable
CREATE TABLE "dc"."warehouses" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."warehouse_users" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "dc"."DcWarehouseRole" NOT NULL DEFAULT 'FLOOR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."products" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "type" "dc"."DcProductType" NOT NULL DEFAULT 'SALE',
    "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
    "category" TEXT,
    "trcloud_sku_id" TEXT,
    "trcloud_product_code" TEXT,
    "reorder_point" INTEGER,
    "image_r2_path" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."product_links" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "dest_module" TEXT NOT NULL,
    "dest_product_id" UUID NOT NULL,
    "dest_branch_id" UUID,

    CONSTRAINT "product_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."stock_balances" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_on_hand" INTEGER NOT NULL DEFAULT 0,
    "qty_in_transit" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."stock_movements" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "dc"."DcMoveKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "balance_after" INTEGER,
    "unit_cost_satang" INTEGER,
    "cost_layer_id" UUID,
    "ref_type" TEXT,
    "ref_id" UUID,
    "source_key" TEXT NOT NULL,
    "post_status" "dc"."DcPostStatus" NOT NULL DEFAULT 'NA',
    "note" TEXT,
    "location_from" TEXT,
    "location_to" TEXT,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."cost_layers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "grn_id" UUID,
    "shipment_id" UUID,
    "qty" INTEGER NOT NULL,
    "cny_unit_cost" DECIMAL(15,4) NOT NULL,
    "fx_rate" DECIMAL(12,6) NOT NULL,
    "fx_date" TIMESTAMPTZ(6) NOT NULL,
    "goods_thb_satang" INTEGER NOT NULL,
    "duty_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "freight_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "broker_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "insurance_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "other_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "landed_unit_satang" INTEGER NOT NULL,
    "vat_claimable_satang" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."suppliers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'CN',
    "contact" TEXT,
    "wechat" TEXT,
    "payment_terms" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."purchase_orders" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "po_code" TEXT NOT NULL,
    "supplier_id" UUID,
    "warehouse_id" UUID,
    "status" "dc"."DcPoStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "fx_rate" DECIMAL(12,6),
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "ordered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."purchase_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cny" DECIMAL(15,4) NOT NULL,
    "unit_price_thb" DECIMAL(15,4),
    "photo_r2_key" TEXT,
    "length_cm" DECIMAL(10,2),
    "width_cm" DECIMAL(10,2),
    "height_cm" DECIMAL(10,2),
    "cbm_per_unit" DECIMAL(12,6),
    "note" TEXT,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."shipments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "po_id" UUID,
    "shipment_code" TEXT NOT NULL,
    "tracking_no" TEXT,
    "mode" "dc"."DcShipmentMode" NOT NULL DEFAULT 'SEA',
    "status" "dc"."DcShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "cbm_total" DECIMAL(12,4),
    "china_freight_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "intl_freight_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "duty_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "broker_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "insurance_thb_satang" INTEGER NOT NULL DEFAULT 0,
    "fx_rate" DECIMAL(12,6),
    "fx_date" TIMESTAMPTZ(6),
    "etd" TIMESTAMPTZ(6),
    "eta" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."shipment_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "cbm" DECIMAL(12,6),

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."goods_receipts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "grn_code" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "po_id" UUID,
    "shipment_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "post_status" "dc"."DcPostStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "received_by_user_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."goods_receipt_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_expected" INTEGER NOT NULL DEFAULT 0,
    "qty_received" INTEGER NOT NULL,
    "qty_damaged" INTEGER NOT NULL DEFAULT 0,
    "cost_layer_id" UUID,
    "note" TEXT,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."transfers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "transfer_code" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "dest_type" "dc"."DcTransferDestType" NOT NULL DEFAULT 'WAREHOUSE',
    "to_warehouse_id" UUID,
    "to_module" TEXT,
    "to_branch_id" UUID,
    "to_label" TEXT,
    "status" "dc"."DcTransferStatus" NOT NULL DEFAULT 'DISPATCHED',
    "same_site" BOOLEAN NOT NULL DEFAULT false,
    "dispatched_by_user_id" UUID NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."transfer_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "qty_received" INTEGER,
    "cost_layer_id" UUID,
    "unit_cost_satang" INTEGER,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc"."outbox_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "target_module" TEXT,
    "payload" JSONB NOT NULL,
    "status" "dc"."DcOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouses_org_id_is_active_idx" ON "dc"."warehouses"("org_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_org_id_code_key" ON "dc"."warehouses"("org_id", "code");

-- CreateIndex
CREATE INDEX "warehouse_users_org_id_user_id_idx" ON "dc"."warehouse_users"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "warehouse_users_warehouse_id_is_active_idx" ON "dc"."warehouse_users"("warehouse_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_users_user_id_warehouse_id_key" ON "dc"."warehouse_users"("user_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "products_org_id_barcode_idx" ON "dc"."products"("org_id", "barcode");

-- CreateIndex
CREATE INDEX "products_org_id_active_type_idx" ON "dc"."products"("org_id", "active", "type");

-- CreateIndex
CREATE UNIQUE INDEX "products_org_id_sku_key" ON "dc"."products"("org_id", "sku");

-- CreateIndex
CREATE INDEX "product_links_org_id_dest_module_idx" ON "dc"."product_links"("org_id", "dest_module");

-- CreateIndex
CREATE UNIQUE INDEX "product_links_product_id_dest_module_dest_product_id_key" ON "dc"."product_links"("product_id", "dest_module", "dest_product_id");

-- CreateIndex
CREATE INDEX "stock_balances_org_id_product_id_idx" ON "dc"."stock_balances"("org_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_warehouse_id_product_id_key" ON "dc"."stock_balances"("warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_org_id_warehouse_id_occurred_at_idx" ON "dc"."stock_movements"("org_id", "warehouse_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_org_id_product_id_occurred_at_idx" ON "dc"."stock_movements"("org_id", "product_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_post_status_idx" ON "dc"."stock_movements"("post_status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_org_id_source_key_key" ON "dc"."stock_movements"("org_id", "source_key");

-- CreateIndex
CREATE INDEX "cost_layers_org_id_product_id_idx" ON "dc"."cost_layers"("org_id", "product_id");

-- CreateIndex
CREATE INDEX "cost_layers_grn_id_idx" ON "dc"."cost_layers"("grn_id");

-- CreateIndex
CREATE INDEX "suppliers_org_id_active_idx" ON "dc"."suppliers"("org_id", "active");

-- CreateIndex
CREATE INDEX "purchase_orders_org_id_status_idx" ON "dc"."purchase_orders"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_org_id_po_code_key" ON "dc"."purchase_orders"("org_id", "po_code");

-- CreateIndex
CREATE INDEX "purchase_lines_org_id_po_id_idx" ON "dc"."purchase_lines"("org_id", "po_id");

-- CreateIndex
CREATE INDEX "shipments_org_id_status_idx" ON "dc"."shipments"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_org_id_shipment_code_key" ON "dc"."shipments"("org_id", "shipment_code");

-- CreateIndex
CREATE INDEX "shipment_lines_org_id_shipment_id_idx" ON "dc"."shipment_lines"("org_id", "shipment_id");

-- CreateIndex
CREATE INDEX "goods_receipts_org_id_warehouse_id_idx" ON "dc"."goods_receipts"("org_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_org_id_grn_code_key" ON "dc"."goods_receipts"("org_id", "grn_code");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_org_id_grn_id_idx" ON "dc"."goods_receipt_lines"("org_id", "grn_id");

-- CreateIndex
CREATE INDEX "transfers_org_id_status_idx" ON "dc"."transfers"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_org_id_transfer_code_key" ON "dc"."transfers"("org_id", "transfer_code");

-- CreateIndex
CREATE INDEX "transfer_lines_org_id_transfer_id_idx" ON "dc"."transfer_lines"("org_id", "transfer_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "dc"."outbox_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_org_id_source_key_event_type_key" ON "dc"."outbox_events"("org_id", "source_key", "event_type");

-- AddForeignKey
ALTER TABLE "dc"."warehouse_users" ADD CONSTRAINT "warehouse_users_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "dc"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."product_links" ADD CONSTRAINT "product_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "dc"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "dc"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."stock_movements" ADD CONSTRAINT "stock_movements_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "dc"."cost_layers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."cost_layers" ADD CONSTRAINT "cost_layers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."cost_layers" ADD CONSTRAINT "cost_layers_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "dc"."goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "dc"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."purchase_lines" ADD CONSTRAINT "purchase_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "dc"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."shipments" ADD CONSTRAINT "shipments_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "dc"."purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "dc"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."goods_receipts" ADD CONSTRAINT "goods_receipts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "dc"."shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "dc"."goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "dc"."transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc"."transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dc"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
