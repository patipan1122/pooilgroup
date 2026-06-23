-- FuelOS: ตารางตำแหน่งรถจาก xsense GPS (ทั้งกองรถ หลายบริษัท)
-- poll จาก xsense /vehicle/tracking → upsert · additive ล้วน · idempotent
CREATE TABLE IF NOT EXISTS "fuel"."fuel_gps_vehicle" (
    "id" UUID NOT NULL,
    "xsense_name" TEXT NOT NULL,
    "plate" TEXT,
    "province" TEXT,
    "group_name" TEXT,
    "device_id" TEXT,
    "driver_id" TEXT,
    "driver_name" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "speed_kmh" DECIMAL(6,2),
    "engine_on" BOOLEAN,
    "moving" BOOLEAN,
    "course_deg" INTEGER,
    "address" TEXT,
    "gps_time" TIMESTAMP(3),
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fuel_gps_vehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fuel_gps_vehicle_xsense_name_key"
    ON "fuel"."fuel_gps_vehicle"("xsense_name");

CREATE INDEX IF NOT EXISTS "fuel_gps_vehicle_group_name_idx"
    ON "fuel"."fuel_gps_vehicle"("group_name");
