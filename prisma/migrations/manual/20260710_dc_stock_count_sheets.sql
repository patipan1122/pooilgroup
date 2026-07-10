-- DC · "ใบนับสต๊อก" (stock count sheet) — หัวใบ + บรรทัด (CEO 2026-07-10 · Wave D)
-- เดิม หน้านับ /dc/count ยิงแค่ COUNT_ADJUST movement ลอย ๆ (ไม่มีเอกสาร "ใบนับ" · ไม่รู้ใครนับ/เมื่อไร).
-- เพิ่ม 2 ตาราง:
--   dc.stock_counts       = หัวใบ (เลขที่ · ใครนับ · หมายเหตุ · คลัง · เวลา)
--   dc.stock_count_lines  = บรรทัดในใบ (snapshot ระบบมี vs นับได้ + ส่วนต่าง ณ ตอนบันทึก)
-- ★ ADDITIVE ล้วน · ไม่แตะ stock_movements/stock_balances เดิม · idempotency ของการปรับสต๊อก
--   ยังอยู่ที่ source_key เดิม (ใบนับเป็น metadata ทับด้านบน). IF NOT EXISTS ทั้งหมด → apply ซ้ำปลอดภัย.

CREATE TABLE IF NOT EXISTS dc.stock_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  count_code    text NOT NULL,
  warehouse_id  uuid NOT NULL,
  note          text,
  actor_user_id uuid,
  counted_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dc_stock_counts_org_code_uq   ON dc.stock_counts (org_id, count_code);
CREATE INDEX        IF NOT EXISTS dc_stock_counts_org_counted_ix ON dc.stock_counts (org_id, counted_at DESC);

CREATE TABLE IF NOT EXISTS dc.stock_count_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  count_id     uuid NOT NULL REFERENCES dc.stock_counts (id) ON DELETE CASCADE,
  product_id   uuid NOT NULL,
  system_qty   integer NOT NULL,
  counted_qty  integer NOT NULL,
  variance     integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dc_stock_count_lines_count_ix ON dc.stock_count_lines (count_id);
