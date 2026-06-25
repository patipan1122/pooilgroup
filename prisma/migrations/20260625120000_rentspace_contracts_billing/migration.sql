-- RentSpace สัญญา + บิล (ชุดฟีเจอร์ CEO 2026-06-25)
-- บัญชีรับเงิน · ค่าใช้จ่ายประจำ (ภาษีที่ดิน ฯลฯ) · สิทธิ์จัดการสัญญา ·
-- ขออนุมัติแก้สัญญาที่เซ็นแล้ว (maker≠checker) · ฉบับแก้ไข (addendum) + เซ็นใหม่
-- ทั้งหมด ADDITIVE — ของเดิม (บิล/สัญญา/มิเตอร์) ไม่กระทบ

-- 1) RentalProject: สิทธิ์จัดการสัญญา (mirror สวิตช์บิล) + บัญชีรับเงินของโครงการ
ALTER TABLE "public"."rental_project"
  ADD COLUMN IF NOT EXISTS "contract_edit_unlocked"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "contract_delete_unlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "bank_name"           TEXT,
  ADD COLUMN IF NOT EXISTS "bank_account_no"     TEXT,
  ADD COLUMN IF NOT EXISTS "bank_account_holder" TEXT,
  ADD COLUMN IF NOT EXISTS "promptpay_id"        TEXT,
  ADD COLUMN IF NOT EXISTS "payment_note"        TEXT;

-- 2) RentalContract: ขออนุมัติแก้สัญญาที่เซ็นแล้ว (maker≠checker · mirror bill void)
ALTER TABLE "public"."rental_contract"
  ADD COLUMN IF NOT EXISTS "edit_status"          TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "edit_request_reason"  TEXT,
  ADD COLUMN IF NOT EXISTS "edit_requested_by"    UUID,
  ADD COLUMN IF NOT EXISTS "edit_requested_at"    TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "edit_decided_by"      UUID,
  ADD COLUMN IF NOT EXISTS "edit_decided_at"      TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "edit_decision_note"   TEXT;

-- 3) ค่าใช้จ่ายประจำ — บวกเข้าทุกบิลอัตโนมัติ (ภาษีที่ดิน/ส่วนกลาง/ขยะ ฯลฯ)
--    unit_id NULL = คิดทั้งโครงการ · ระบุ = คิดเฉพาะห้องนั้น · vatable=false = ภาษีส่งต่อไม่บวก VAT
CREATE TABLE IF NOT EXISTS public.rental_recurring_charge (
  id         UUID PRIMARY KEY,
  org_id     UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.rental_project(id) ON DELETE CASCADE,
  unit_id    UUID REFERENCES public.rental_unit(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'other',
  label      TEXT NOT NULL,
  amount_thb DECIMAL(15,2) NOT NULL DEFAULT 0,
  vatable    BOOLEAN NOT NULL DEFAULT false,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_recurring_charge_org_project_active_idx
  ON public.rental_recurring_charge(org_id, project_id, is_active);
CREATE INDEX IF NOT EXISTS rental_recurring_charge_unit_idx
  ON public.rental_recurring_charge(unit_id);

-- 4) ฉบับแก้ไขสัญญา (addendum) — แก้สัญญาที่เซ็นแล้วต้องออกฉบับแก้ไข + เซ็นใหม่
CREATE TABLE IF NOT EXISTS public.rental_contract_addendum (
  id                 UUID PRIMARY KEY,
  org_id             UUID NOT NULL,
  contract_id        UUID NOT NULL REFERENCES public.rental_contract(id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL DEFAULT 1,
  summary            TEXT NOT NULL,
  body_html          TEXT,
  sign_token         TEXT,
  signed_at          TIMESTAMPTZ(6),
  tenant_signed      BOOLEAN NOT NULL DEFAULT false,
  signature_data_url TEXT,
  signer_name        TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_contract_addendum_sign_token_key
  ON public.rental_contract_addendum(sign_token);
CREATE INDEX IF NOT EXISTS rental_contract_addendum_org_contract_seq_idx
  ON public.rental_contract_addendum(org_id, contract_id, seq);
