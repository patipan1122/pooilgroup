-- ClawOS · ultrareview Wave 4b — maker-checker: ฝากขาด + นับสต็อกมูลค่าสูง ต้องคนที่ 2 อนุมัติ (2026-07-02)
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code (schema-gate).
-- default ('NONE'/'APPLIED') → แถวเดิมไม่ค้าง PENDING · ของใหม่ที่เข้าเกณฑ์ตั้ง PENDING ในโค้ด.

-- ใบฝากขาด (SHORT) ต้องอนุมัติ
ALTER TABLE public.cf_cash_deposits ADD COLUMN IF NOT EXISTS approval_status  text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.cf_cash_deposits ADD COLUMN IF NOT EXISTS reviewed_by_id   uuid;
ALTER TABLE public.cf_cash_deposits ADD COLUMN IF NOT EXISTS reviewed_by_name text;
ALTER TABLE public.cf_cash_deposits ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz;
ALTER TABLE public.cf_cash_deposits ADD COLUMN IF NOT EXISTS review_note      text;
CREATE INDEX IF NOT EXISTS cf_cash_deposits_org_approval_idx ON public.cf_cash_deposits (org_id, approval_status);

-- นับสต็อกมูลค่าสูง ต้องอนุมัติก่อนตัดสต๊อกจริง
ALTER TABLE public.cf_stock_counts ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'APPLIED';
ALTER TABLE public.cf_stock_counts ADD COLUMN IF NOT EXISTS reviewed_by_id   uuid;
ALTER TABLE public.cf_stock_counts ADD COLUMN IF NOT EXISTS reviewed_by_name text;
ALTER TABLE public.cf_stock_counts ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz;
ALTER TABLE public.cf_stock_counts ADD COLUMN IF NOT EXISTS review_note      text;
CREATE INDEX IF NOT EXISTS cf_stock_counts_org_status_idx ON public.cf_stock_counts (org_id, status);
