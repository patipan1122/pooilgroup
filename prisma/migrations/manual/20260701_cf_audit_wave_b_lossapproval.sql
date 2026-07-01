-- ClawOS · audit wave B — D1 write-off maker-checker (2026-07-01)
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code.
-- ตัดของเสียมูลค่าสูง (CfLossDoc) ต้องมีคนที่ 2 อนุมัติ (กันพนักงานซ่อน shrinkage คนเดียวจบ).
-- default 'APPROVED' → แถวเดิมไม่ค้าง PENDING · ของใหม่ที่เกินเกณฑ์ตั้ง PENDING ในโค้ด.

ALTER TABLE public.cf_loss_docs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'APPROVED';
ALTER TABLE public.cf_loss_docs ADD COLUMN IF NOT EXISTS reviewed_by_id uuid;
ALTER TABLE public.cf_loss_docs ADD COLUMN IF NOT EXISTS reviewed_by_name text;
ALTER TABLE public.cf_loss_docs ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.cf_loss_docs ADD COLUMN IF NOT EXISTS review_note text;
