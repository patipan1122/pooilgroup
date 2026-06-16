-- CashHub Café Amazon — ทะเบียนสาขา (ให้ super_admin เพิ่มสาขาเองได้ ไม่ต้องแก้โค้ด)
-- เดิม: รายชื่อสาขา + ค่าตั้งบัญชี TRCloud ฝังในโค้ด (AMAZON_BRANCH_LIST) → มีสาขาใหม่ต้องให้ dev เพิ่ม.
-- ใหม่: เก็บใน DB. ค่าตั้งบัญชี (สูตร/โครงการ/แผนก/คู่ค้า) ดึงจากใบจริงใน TRCloud อัตโนมัติ (กันตั้งผิด=ลงบัญชีผิดร้าน).
-- สาขา built-in 2 สาขา (ชุมชนหัวทะเล/เทศบาลจักราช) ยังอยู่ในโค้ดเป็น fallback — ตารางนี้คือสาขาที่ "เพิ่มเพิ่มเติม".

CREATE TABLE IF NOT EXISTS public.cashhub_amazon_branch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,

  -- ── ตัวจับคู่ไฟล์ POS ──────────────────────────────────
  store_code    varchar(12),                 -- รหัสสาขา POS (ว่างได้ → จับคู่ด้วยชื่อ)
  name_match    varchar(160) NOT NULL,       -- คำในชื่อสาขา (POS label) ที่ใช้จับคู่
  aliases       jsonb NOT NULL DEFAULT '[]', -- ชื่อเรียกอื่นของสาขาเดียวกัน (POS เรียกต่างจาก TRCloud)
  label         varchar(160) NOT NULL,       -- ชื่อแสดงผล

  -- ── ค่าตั้งบัญชี TRCloud (ดึงจากใบจริง — ห้ามเดา) ────────
  type          varchar(120) NOT NULL,       -- สูตรบัญชี เช่น "AMAZON เทศบาลจักราช[IV]"
  project       varchar(160) NOT NULL,       -- รหัสโครงการ
  department    varchar(60)  NOT NULL,       -- แผนก
  contact_id    varchar(40)  NOT NULL,       -- รหัส contact คู่ค้า
  group_code    varchar(20)  NOT NULL,       -- กลุ่มคู่ค้า (อักษรนำหน้า)
  code_number   varchar(40)  NOT NULL,       -- เลขรหัสคู่ค้า (รหัสคู่ค้า = group_code + code_number)
  customer_name varchar(200) NOT NULL,

  -- ── สินค้า (ปกติเหมือนกันทุกสาขา Amazon) ────────────────
  product_id    varchar(40)  NOT NULL DEFAULT 'P-00005',
  product_name  varchar(120) NOT NULL DEFAULT 'กาแฟ CAFE AMAZON',
  unit          varchar(20)  NOT NULL DEFAULT 'วัน',

  -- ── meta ──────────────────────────────────────────────
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, project)                    -- 1 สาขา = 1 โครงการ ต่อ org (idempotent upsert)
);

CREATE INDEX IF NOT EXISTS cashhub_amazon_branch_org_idx
  ON public.cashhub_amazon_branch (org_id, is_active);

ALTER TABLE public.cashhub_amazon_branch ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือน cashhub_amazon_daily — query scope org_id เสมอ
