-- ClawFleet สาขา "ส่งคืนคลังกลาง (DC)" · 2-step return (สาขาส่ง → DC รับคืน) · 2026-08-01
-- ADDITIVE ONLY: 2 ตารางใหม่ + 1 enum. ไม่แตะตาราง/คอลัมน์เดิม → ปลอดภัยต่อระบบที่รันอยู่.
-- idempotent: IF NOT EXISTS ทุกจุด (รันซ้ำได้).

DO $$ BEGIN
  CREATE TYPE public."CfBranchReturnStatus" AS ENUM ('PENDING', 'RECEIVING', 'CONFIRMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cf_branch_returns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  branch_id             uuid NOT NULL,
  return_code           text NOT NULL,
  client_key            text NOT NULL,
  to_warehouse_id       uuid NOT NULL,
  status                public."CfBranchReturnStatus" NOT NULL DEFAULT 'PENDING',
  note                  text,
  source_transfer_code  text,
  dispatched_by_user_id uuid NOT NULL,
  dispatched_at         timestamptz(6) NOT NULL DEFAULT now(),
  confirmed_by_user_id  uuid,
  confirmed_at          timestamptz(6),
  created_at            timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cf_branch_returns_org_id_return_code_key
  ON public.cf_branch_returns (org_id, return_code);
CREATE UNIQUE INDEX IF NOT EXISTS cf_branch_returns_org_id_client_key_key
  ON public.cf_branch_returns (org_id, client_key);
CREATE INDEX IF NOT EXISTS cf_branch_returns_org_id_status_idx
  ON public.cf_branch_returns (org_id, status);
CREATE INDEX IF NOT EXISTS cf_branch_returns_org_id_branch_id_idx
  ON public.cf_branch_returns (org_id, branch_id);
CREATE INDEX IF NOT EXISTS cf_branch_returns_org_id_to_warehouse_id_status_idx
  ON public.cf_branch_returns (org_id, to_warehouse_id, status);

CREATE TABLE IF NOT EXISTS public.cf_branch_return_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  return_id       uuid NOT NULL,
  cf_product_id   uuid NOT NULL,
  dc_product_id   uuid,
  product_name    text NOT NULL,
  qty             integer NOT NULL,
  unit_cost_cents integer NOT NULL DEFAULT 0,
  CONSTRAINT cf_branch_return_lines_return_id_fkey
    FOREIGN KEY (return_id) REFERENCES public.cf_branch_returns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cf_branch_return_lines_org_id_return_id_idx
  ON public.cf_branch_return_lines (org_id, return_id);
