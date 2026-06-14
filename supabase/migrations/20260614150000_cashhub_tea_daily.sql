-- CashHub ร้านชาไข่มุก (OWL CHA / MR.WOOF / SNOW DIP — POS Foodstory) — ยอดขายรายวันต่อสาขา
-- ต่างจาก Amazon: IV ถูกคีย์ใน TRCloud อยู่แล้ว (1 ใบ/วัน/สาขา) → เรา "ดึงกลับมา" เป็นต้นทาง
-- แล้วเทียบกับยอดขายจริงจาก POS Foodstory (เติมทีหลัง). 1 แถว/สาขา/วัน. cache กัน TRCloud 429.

CREATE TABLE IF NOT EXISTS public.cashhub_tea_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  branch_code   varchar(24) NOT NULL,        -- คีย์ย่อ เช่น "OWLCHA-002"
  branch_label  varchar(160),                -- "OWL CHA ชุมพวง"
  sales_date    date NOT NULL,

  -- ── IV ใน TRCloud (ต้นทาง — ดึงมา) ─────────────────────
  iv_doc_no     varchar(40),
  iv_doc_id     varchar(40),
  iv_gross      numeric(15,2),               -- grand_total (รวม VAT)
  iv_total      numeric(15,2),               -- ก่อน VAT
  iv_vat        numeric(15,2),               -- VAT
  iv_status     varchar(12) NOT NULL DEFAULT 'none',  -- none | posted
  iv_project    varchar(120),                -- project string เต็มใน TRCloud
  iv_checked_at timestamptz,                 -- ครั้งล่าสุดที่ดึง TRCloud

  -- ── POS Foodstory (เทียบ — เติมทีหลัง) ─────────────────
  pos_gross     numeric(15,2),               -- ยอดขายจริงหน้าร้าน
  pos_source    varchar(200),                -- ชื่อไฟล์ที่อัป
  match_state   varchar(12),                 -- match | mismatch | no_pos | no_iv

  raw_json      jsonb,                        -- IV ดิบจาก TRCloud (audit/ตรวจย้อน)
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, branch_code, sales_date)    -- idempotent: 1 แถว/สาขา/วัน
);

-- หน้า matrix โหลดทั้งเดือนทุกสาขา → index ที่ (org, วันที่)
CREATE INDEX IF NOT EXISTS cashhub_tea_daily_month_idx
  ON public.cashhub_tea_daily (org_id, sales_date);
CREATE INDEX IF NOT EXISTS cashhub_tea_daily_branch_idx
  ON public.cashhub_tea_daily (org_id, branch_code, sales_date);

ALTER TABLE public.cashhub_tea_daily ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือน cashhub_amazon_daily — query scope org_id เสมอ
