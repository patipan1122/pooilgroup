-- ClawOS · ultrareview Wave 4a — custody→deposit (2026-07-02)
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code (schema-gate).
-- ปิดจุดบอดเงิน "มือพนักงาน → ธนาคาร": พิสูจน์ว่าเงินที่เก็บได้ ถูกฝากครบ (reconcile ฝากจริง vs เก็บได้).
-- cf_collection_sessions +deposit_id (null = ยังไม่ฝาก · "ค้างมือ") · cf_cash_deposits = ใบฝาก (ครอบได้หลายรอบ).

ALTER TABLE public.cf_collection_sessions ADD COLUMN IF NOT EXISTS deposit_id uuid;
CREATE INDEX IF NOT EXISTS cf_sessions_org_deposit_idx ON public.cf_collection_sessions (org_id, deposit_id);

CREATE TABLE IF NOT EXISTS public.cf_cash_deposits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  branch_id          uuid NOT NULL,
  deposit_code       text NOT NULL,
  amount_cents       integer NOT NULL,
  expected_cents     integer NOT NULL,
  variance_cents     integer NOT NULL,
  status             text NOT NULL DEFAULT 'OK',
  session_count      integer NOT NULL DEFAULT 0,
  slip_photo_url     text,
  note               text,
  deposited_by_id    uuid,
  deposited_by_name  text NOT NULL,
  deposited_at       timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cf_cash_deposits_org_code_uidx ON public.cf_cash_deposits (org_id, deposit_code);
CREATE INDEX IF NOT EXISTS cf_cash_deposits_org_branch_idx ON public.cf_cash_deposits (org_id, branch_id, deposited_at DESC);
CREATE INDEX IF NOT EXISTS cf_cash_deposits_org_status_idx ON public.cf_cash_deposits (org_id, status);

-- FK session.deposit_id → cf_cash_deposits (ลบใบฝาก → รอบกลับเป็น "ยังไม่ฝาก")
DO $$ BEGIN
  ALTER TABLE public.cf_collection_sessions
    ADD CONSTRAINT cf_sessions_deposit_fk
    FOREIGN KEY (deposit_id) REFERENCES public.cf_cash_deposits(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
