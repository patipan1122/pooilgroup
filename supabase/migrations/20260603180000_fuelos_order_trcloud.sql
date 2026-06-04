-- FuelOS · ออก IV เข้า TRCloud ตอนยืนยันออเดอร์ — เก็บ id/เลขที่ IV + error บน order
ALTER TABLE fuel.orders ADD COLUMN IF NOT EXISTS trcloud_iv_id    text;
ALTER TABLE fuel.orders ADD COLUMN IF NOT EXISTS trcloud_iv_no    text;
ALTER TABLE fuel.orders ADD COLUMN IF NOT EXISTS trcloud_synced_at timestamptz;
ALTER TABLE fuel.orders ADD COLUMN IF NOT EXISTS trcloud_error    text;
