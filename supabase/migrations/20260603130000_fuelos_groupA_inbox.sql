-- FuelOS bigfeature · GROUP A (inbox overhaul)
-- 1) Customer.nickname (ชื่อเล่น)
-- 2) fuel.line_contacts — per-person LINE identity (ชื่อจริง+รูป+alias+ป้ายบทบาท)
-- fuel schema = app-layer org scoping (NO Postgres RLS · match existing fuel tables).

ALTER TABLE fuel.customers ADD COLUMN IF NOT EXISTS nickname text;

CREATE TABLE IF NOT EXISTS fuel.line_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  channel_id   uuid NOT NULL,
  line_user_id text NOT NULL,
  display_name text,          -- ชื่อจริงจาก LINE (original)
  picture_url  text,          -- รูปโปรไฟล์จาก LINE
  alias        text,          -- ชื่อที่พนักงานตั้งเอง (rename)
  role_label   text,          -- ป้าย เช่น เถ้าแก่/บัญชี/จัดซื้อ
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS line_contacts_channel_user_key
  ON fuel.line_contacts (channel_id, line_user_id);
CREATE INDEX IF NOT EXISTS line_contacts_org_idx
  ON fuel.line_contacts (org_id);
