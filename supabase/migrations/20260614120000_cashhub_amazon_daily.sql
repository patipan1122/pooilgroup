-- CashHub Café Amazon — ยอดขายรายวันจาก POS + สถานะ IV ใน TRCloud (เซฟถาวร + เทียบ POS↔TRC)
-- 1 แถว/สาขา/วัน. key = (org, store_code, วันที่). gross = ยอดขาย POS (VAT-in).
-- iv_* = ใบกำกับใน TRCloud (ดึงกลับมาเทียบว่าตรงกับ POS ไหม). channels = special-note c-vars.

CREATE TABLE IF NOT EXISTS public.cashhub_amazon_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  store_code    varchar(12) NOT NULL,        -- POS store code เช่น "5157"
  branch_label  varchar(160),                -- "ชุมชนหัวทะเล"
  sales_date    date NOT NULL,

  -- ── ยอดจาก POS (ไฟล์ปิดกะ) ────────────────────────────
  gross         numeric(15,2) NOT NULL,      -- ยอดขายรวม (รวม VAT)
  total         numeric(15,2),               -- ก่อน VAT (= gross/1.07)
  vat           numeric(15,2),               -- VAT 7%
  channels      jsonb,                        -- {"c1":..,"c2":..} special-note c-vars
  balanced      boolean NOT NULL DEFAULT true,
  block_reason  text,                         -- เหตุผลที่ยังคีย์ IV ไม่ได้ (ปิดกะไม่เสร็จ ฯลฯ)

  -- ── IV ใน TRCloud (เทียบ POS↔TRC) ─────────────────────
  iv_doc_no     varchar(40),
  iv_doc_id     varchar(40),
  iv_status     varchar(12) NOT NULL DEFAULT 'none',   -- none | posted
  iv_gross      numeric(15,2),                -- ยอด IV ที่ดึงกลับจาก TRCloud
  match_state   varchar(12),                  -- match | mismatch | no_iv (เทียบ gross vs iv_gross)
  iv_checked_at timestamptz,                  -- ครั้งล่าสุดที่ดึง TRCloud มาเทียบ

  -- ── meta ──────────────────────────────────────────────
  raw_json      jsonb,                        -- แถวดิบจากไฟล์ (audit/ตรวจย้อน)
  source_file   varchar(200),
  imported_by   uuid,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, store_code, sales_date)     -- idempotent: 1 แถว/สาขา/วัน
);

CREATE INDEX IF NOT EXISTS cashhub_amazon_daily_lookup_idx
  ON public.cashhub_amazon_daily (org_id, store_code, sales_date);

ALTER TABLE public.cashhub_amazon_daily ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือน cashhub_hotel_daily — query scope org_id เสมอ
