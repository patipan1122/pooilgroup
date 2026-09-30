-- Playland: persist device direction (IN/OUT) so server code (which can't
-- reach devices on the shop LAN directly) can tell entrance vs exit devices
-- apart without a live query. Mirrors the device-side `inout` param.
CREATE TYPE playland."PlaylandDeviceDirection" AS ENUM ('IN', 'OUT');

ALTER TABLE playland.devices
  ADD COLUMN "direction" playland."PlaylandDeviceDirection";

-- Backfill the 2 real devices at ปตท ชุมพวง (confirmed live via getDeviceParameter 2026-09-30)
UPDATE playland.devices SET "direction" = 'IN'  WHERE device_id = 'T77QR6301FZS';
UPDATE playland.devices SET "direction" = 'OUT' WHERE device_id = 'T77QR6305CZS';
