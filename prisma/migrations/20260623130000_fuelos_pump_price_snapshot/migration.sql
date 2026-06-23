-- FuelOS: เก็บ snapshot ราคาหน้าปั๊มอ้างอิง (ขายปลีก) รายวัน ไว้ดูย้อนหลัง
-- ข้อมูลสาธารณะระดับประเทศจาก thai-oil-api (ไม่ผูก org) · cron บันทึกวันละ 1 ครั้ง
-- additive ล้วน · idempotent (IF NOT EXISTS) · ไม่กระทบตารางเดิม
CREATE TABLE IF NOT EXISTS "fuel"."fuel_pump_price_snapshot" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source_date" TEXT,
    "station_key" TEXT NOT NULL,
    "station_label" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fuel_pump_price_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fuel_pump_price_snapshot_date_station_key_product_name_key"
    ON "fuel"."fuel_pump_price_snapshot"("date", "station_key", "product_name");

CREATE INDEX IF NOT EXISTS "fuel_pump_price_snapshot_date_idx"
    ON "fuel"."fuel_pump_price_snapshot"("date");

CREATE INDEX IF NOT EXISTS "fuel_pump_price_snapshot_station_key_product_name_date_idx"
    ON "fuel"."fuel_pump_price_snapshot"("station_key", "product_name", "date");
