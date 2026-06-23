-- FuelOS GPS merge — รวมของผมเข้ากับฟีเจอร์ GPS เดิมบน setup (table fuel_gps_vehicle)
-- ลบตารางซ้ำ/enum ที่ผมสร้างรอบแรก · เติมคอลัมน์น้ำมันใน fuel_gps_vehicle · สร้าง gps_daily_stats ใหม่ (key xsense_name)
-- gps_configs (orgId-scoped) ที่สร้างไว้รอบแรก = คงไว้ (schema ตรงกับ model ใหม่)
-- apply: npx prisma db execute --file prisma/migrations/20260623_fuelos_xsense_gps_merge.sql

-- 1) ลบตารางซ้ำของรอบแรก (gps_daily_stats เก่า FK → gps_vehicles → ลบก่อน)
DROP TABLE IF EXISTS fuel.gps_daily_stats;
DROP TABLE IF EXISTS fuel.gps_vehicles;

-- 2) ลบ enum ที่ไม่ใช้แล้ว (ของเดิมใช้ boolean engine_on/moving)
DROP TYPE IF EXISTS fuel."FuelGpsEngineStatus";
DROP TYPE IF EXISTS fuel."FuelGpsMoveStatus";

-- 3) เติมฐานกระทบยอดน้ำมันใน fuel_gps_vehicle เดิม
ALTER TABLE fuel.fuel_gps_vehicle
  ADD COLUMN IF NOT EXISTS fuel_pct      numeric(5,2),
  ADD COLUMN IF NOT EXISTS fuel_raw_adc3 integer,
  ADD COLUMN IF NOT EXISTS odometer_km   numeric(14,2);

-- 4) สรุปรายวันต่อคัน (key = xsense_name + วัน)
CREATE TABLE IF NOT EXISTS fuel.gps_daily_stats (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  xsense_name       text NOT NULL,
  stat_date         date NOT NULL,
  distance_km       numeric(10,2) NOT NULL DEFAULT 0,
  move_seconds      integer NOT NULL DEFAULT 0,
  idle_seconds      integer NOT NULL DEFAULT 0,
  stop_seconds      integer NOT NULL DEFAULT 0,
  no_signal_seconds integer NOT NULL DEFAULT 0,
  point_count       integer NOT NULL DEFAULT 0,
  fuel_start_pct    numeric(5,2),
  fuel_end_pct      numeric(5,2),
  litres_filled     numeric(10,2),
  litres_consumed   numeric(10,2),
  synced_at         timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gps_daily_stats_pkey PRIMARY KEY (id),
  CONSTRAINT fuel_gps_daily_stat_name_date_key UNIQUE (xsense_name, stat_date)
);
CREATE INDEX IF NOT EXISTS gps_daily_stats_date_idx ON fuel.gps_daily_stats (stat_date);
