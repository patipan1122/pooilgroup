-- LedgerLine · โครงการชั่วคราว (job-costing · F2) + งวดงาน (progress payment · F3) — 2026-07-10.
-- Additive only · schema public · Buildly-side dimension (ไม่ push TRCloud).
-- SAFETY INVARIANT: project_id บน ledger_expense = NULLABLE → ยอด/รายงานเดิมทุกตัวเท่าเดิม
--   (null = ไม่ผูกโครงการ · reads เดิมไม่ filter project_id). ไม่แตะเงิน/มิเตอร์/confirm/ขอโอน.
-- ⚠️ ห้ามต่อ FK เข้า rental_project (คนละโมดูล · Cascade children) — ตารางนี้ชื่อ ledger_project แยกเด็ดขาด.

-- ── F2 · ตารางโครงการ ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_project (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active',   -- active | archived (ลบ = archive เท่านั้น)
  budget_total numeric(15,2),                     -- งบทั้งโครงการ (เทียบ "ยอดจ่ายจริง" = total−WHT)
  started_at   date,
  ended_at     date,
  note         text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_project_org_company_name_key
  ON public.ledger_project (org_id, company_id, name);
CREATE INDEX IF NOT EXISTS ledger_project_org_company_status_idx
  ON public.ledger_project (org_id, company_id, status);

-- ── F2 · project_id บน expense (orthogonal tag) ────────────────────────────
-- ON DELETE SET NULL: ถ้าโครงการถูกลบจริง ใบเสร็จไม่หาย (แต่ path จริง = soft-archive).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS project_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_expense_project_id_fkey'
  ) THEN
    ALTER TABLE public.ledger_expense
      ADD CONSTRAINT ledger_expense_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.ledger_project(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ledger_expense_org_company_project_status_idx
  ON public.ledger_expense (org_id, company_id, project_id, status);

-- ── F3 · ตารางงวดงาน ──────────────────────────────────────────────────────
-- project_id NOT NULL + ON DELETE CASCADE: งวดเป็น plan-row ไร้ความหมายถ้าไม่มีโครงการ
--   (คนละกรณีกับ expense ที่เป็นเงิน/ใบเสร็จ = SET NULL). paid ต้องผูก payment_request/expense จริง.
CREATE TABLE IF NOT EXISTS public.ledger_installment (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id              uuid NOT NULL REFERENCES public.ledger_project(id) ON DELETE CASCADE,
  seq                     integer NOT NULL DEFAULT 1,
  label                   text NOT NULL DEFAULT '',
  vendor_label            text,
  due_date                date,
  planned_amount          numeric(15,2) NOT NULL DEFAULT 0,   -- ยอดสัญญา (gross · โชว์ "โอนจริง"=gross−WHT แยก)
  status                  text NOT NULL DEFAULT 'planned',    -- planned | paid_pending_slip | paid | broken | void
  paid_payment_request_id uuid REFERENCES public.ledger_payment_request(id) ON DELETE SET NULL,
  paid_expense_id         uuid REFERENCES public.ledger_expense(id) ON DELETE SET NULL,
  paid_at                 timestamptz,
  paid_by                 uuid,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_installment_org_company_project_seq_idx
  ON public.ledger_installment (org_id, company_id, project_id, seq);
-- มาร์คจ่ายได้ครั้งเดียวต่อ payment request (idempotency · กันงวด 2 อันผูก request เดียว / จ่ายซ้ำ)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_installment_paid_payment_request_uniq
  ON public.ledger_installment (org_id, company_id, paid_payment_request_id)
  WHERE paid_payment_request_id IS NOT NULL;
-- บิลเงินสด (paid_expense_id) ก็ผูกได้งวดเดียว — กัน double-anchor race (clash-check app-level
-- ไม่พอถ้ากดพร้อมกัน → DB ปฏิเสธคนที่ 2 · ไม่งั้น paidTrustedTotal นับบิลเดียวซ้ำ 2 งวด)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_installment_paid_expense_uniq
  ON public.ledger_installment (org_id, company_id, paid_expense_id)
  WHERE paid_expense_id IS NOT NULL;
