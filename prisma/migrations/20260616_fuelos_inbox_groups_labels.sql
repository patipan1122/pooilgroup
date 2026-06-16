-- FuelOS กล่องแชท: รูปโปรไฟล์กลุ่ม + จัดหมวดหมู่ (ป้าย/โฟลเดอร์ที่ผู้ใช้สร้างเอง)
-- Additive ล้วน — เพิ่มคอลัมน์ nullable + 2 ตารางใหม่ ไม่แตะข้อมูลเดิม ไม่ backfill ไม่ lock
-- กระทบ: หน้า /fuelos/inbox (แสดงรูปกลุ่ม + กรองตามป้าย) เท่านั้น

-- 1) cache รูป + ชื่อกลุ่มจาก LINE ลงห้องสนทนา (ดึงครั้งแรกครั้งเดียว → ประหยัด API)
ALTER TABLE fuel.conversations ADD COLUMN IF NOT EXISTS picture_url TEXT;
ALTER TABLE fuel.conversations ADD COLUMN IF NOT EXISTS line_group_name TEXT;

-- 2) ป้าย/หมวดหมู่แชทที่ผู้ใช้สร้างเอง (ต่อองค์กร) — เช่น "ซัพพลายเออร์" "ลูกค้า VIP"
CREATE TABLE IF NOT EXISTS fuel.conv_labels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL,
  name       text        NOT NULL,
  color      text        NOT NULL DEFAULT 'brand',
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- กันชื่อป้ายซ้ำในองค์กรเดียวกัน (= @@unique([orgId, name]) ของ Prisma)
CREATE UNIQUE INDEX IF NOT EXISTS conv_labels_org_name_key ON fuel.conv_labels (org_id, name);
CREATE INDEX IF NOT EXISTS conv_labels_org_idx ON fuel.conv_labels (org_id, sort_order);

-- 3) แชท ↔ ป้าย (many-to-many · 1 แชทติดได้หลายป้าย)
CREATE TABLE IF NOT EXISTS fuel.conv_label_links (
  conversation_id uuid        NOT NULL REFERENCES fuel.conversations(id) ON DELETE CASCADE,
  label_id        uuid        NOT NULL REFERENCES fuel.conv_labels(id)   ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, label_id)
);
CREATE INDEX IF NOT EXISTS conv_label_links_label_idx ON fuel.conv_label_links (label_id);
