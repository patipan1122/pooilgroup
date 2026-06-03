-- Pooilgroup ERP — LEDGER MODULE (LedgerLine · slug "ledger") init
-- 2026-06-02 · 6 tables: ledger_category, ledger_expense, ledger_expense_item,
--                        ledger_budget, ledger_line_channel, ledger_export_batch
--
-- Pattern: matches existing RLS migrations (org_id-direct policy via current_org_id()).
-- Goal: capture → AI OCR → Recheck → human-confirm → store. NEVER auto-post
--       (expenses default status='draft' until accountant confirms).
-- 3-tier tenancy: org_id + company_id + branch_id · RLS org_id = current_org_id().
-- Run order: AFTER `prisma db push` / generate creates the table shapes (or this
--            file is the source of truth — column types match prisma/schema.prisma).
--
-- Defer-pending-secret: ledger_line_channel.webhook_secret_enc / access_token_enc
--   stay NULL until CEO supplies LINE OA secrets (see docs/LEDGER_SETUP.md).

-- ============================================================
-- Enums (Prisma names them PascalCase under @@schema("public"))
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public."LedgerExpenseStatus" AS ENUM ('draft', 'confirmed', 'locked', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."LedgerExpenseSource" AS ENUM ('line', 'web', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 1. ledger_category — หมวดค่าใช้จ่ายต่อบริษัท
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_category (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  company_id       uuid NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'expense',
  color            text,
  trcloud_acc_code text,
  sort             integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_category_org_company_name_key
  ON public.ledger_category (org_id, company_id, name);
CREATE INDEX IF NOT EXISTS ledger_category_org_company_active_sort_idx
  ON public.ledger_category (org_id, company_id, active, sort);

-- ============================================================
-- 2. ledger_expense — core (1 ใบเสร็จ/สลิป = 1 row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_expense (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  company_id      uuid NOT NULL,
  branch_id       uuid,
  doc_code        text NOT NULL,
  status          public."LedgerExpenseStatus" NOT NULL DEFAULT 'draft',
  source          public."LedgerExpenseSource" NOT NULL DEFAULT 'web',
  vendor          text,
  vendor_tax_id   text,
  doc_date        date,
  subtotal        numeric(15,2) NOT NULL DEFAULT 0,
  vat             numeric(15,2) NOT NULL DEFAULT 0,
  wht             numeric(15,2) NOT NULL DEFAULT 0,
  total           numeric(15,2) NOT NULL DEFAULT 0,
  category_id     uuid,
  payment_method  text,
  original_url    text,
  thumb_url       text,
  sha256          text,
  ocr_model       text,
  ocr_confidence  jsonb,
  slip_ref        text,
  needs_review    boolean NOT NULL DEFAULT true,
  note            text,
  created_by      uuid,
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  export_batch_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_expense_org_company_doccode_key
  ON public.ledger_expense (org_id, company_id, doc_code);
CREATE INDEX IF NOT EXISTS ledger_expense_org_company_branch_status_idx
  ON public.ledger_expense (org_id, company_id, branch_id, status);
CREATE INDEX IF NOT EXISTS ledger_expense_org_company_status_docdate_idx
  ON public.ledger_expense (org_id, company_id, status, doc_date DESC);
CREATE INDEX IF NOT EXISTS ledger_expense_org_company_category_idx
  ON public.ledger_expense (org_id, company_id, category_id);
CREATE INDEX IF NOT EXISTS ledger_expense_sha256_idx
  ON public.ledger_expense (sha256);
CREATE INDEX IF NOT EXISTS ledger_expense_export_batch_idx
  ON public.ledger_expense (export_batch_id);

-- ============================================================
-- 3. ledger_expense_item — รายการย่อยในใบเสร็จ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_expense_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  expense_id  uuid NOT NULL REFERENCES public.ledger_expense (id) ON DELETE CASCADE,
  description text NOT NULL,
  qty         numeric(15,3) NOT NULL DEFAULT 1,
  unit_price  numeric(15,2) NOT NULL DEFAULT 0,
  amount      numeric(15,2) NOT NULL DEFAULT 0,
  vat_rate    numeric(6,4),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_expense_item_expense_idx
  ON public.ledger_expense_item (expense_id);
CREATE INDEX IF NOT EXISTS ledger_expense_item_org_company_idx
  ON public.ledger_expense_item (org_id, company_id);

-- ============================================================
-- 4. ledger_budget — งบรายหมวดรายเดือน + เตือน
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_budget (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  branch_id   uuid,
  category_id uuid NOT NULL REFERENCES public.ledger_category (id) ON DELETE CASCADE,
  period      text NOT NULL,
  recurring   boolean NOT NULL DEFAULT false,
  amount      numeric(15,2) NOT NULL DEFAULT 0,
  alert_pct   integer NOT NULL DEFAULT 90,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- unique with nullable branch_id: use COALESCE-style partial uniqueness via two indexes.
-- (Prisma @@unique treats NULLs as distinct; mirror Postgres default behaviour.)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_budget_unique_key
  ON public.ledger_budget (org_id, company_id, branch_id, category_id, period);
CREATE INDEX IF NOT EXISTS ledger_budget_org_company_period_idx
  ON public.ledger_budget (org_id, company_id, period);

-- ============================================================
-- 5. ledger_line_channel — ผูกกลุ่ม LINE (secrets stub Phase 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_line_channel (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  company_id         uuid NOT NULL,
  line_channel_id    text NOT NULL,
  webhook_secret_enc text,  -- TODO[ledger-secret] · NULL until CEO supplies LINE OA secret
  access_token_enc   text,  -- TODO[ledger-secret]
  group_id           text,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_line_channel_org_channel_key
  ON public.ledger_line_channel (org_id, line_channel_id);
CREATE INDEX IF NOT EXISTS ledger_line_channel_org_company_active_idx
  ON public.ledger_line_channel (org_id, company_id, active);
CREATE INDEX IF NOT EXISTS ledger_line_channel_channel_idx
  ON public.ledger_line_channel (line_channel_id);

-- ============================================================
-- 6. ledger_export_batch — งวด export เข้า TRCloud
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_export_batch (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  company_id  uuid NOT NULL,
  period      text NOT NULL,
  format      text NOT NULL DEFAULT 'csv',
  status      text NOT NULL DEFAULT 'pending',
  rows        integer NOT NULL DEFAULT 0,
  exported_at timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_export_batch_org_company_period_idx
  ON public.ledger_export_batch (org_id, company_id, period);

-- FK: ledger_expense.export_batch_id → ledger_export_batch (added after both exist)
DO $$ BEGIN
  ALTER TABLE public.ledger_expense
    ADD CONSTRAINT ledger_expense_export_batch_fk
    FOREIGN KEY (export_batch_id) REFERENCES public.ledger_export_batch (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK: ledger_expense.category_id → ledger_category (SET NULL)
DO $$ BEGIN
  ALTER TABLE public.ledger_expense
    ADD CONSTRAINT ledger_expense_category_fk
    FOREIGN KEY (category_id) REFERENCES public.ledger_category (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- RLS — org isolation (mirror current_org_id() pattern across all 6 tables)
-- ============================================================
ALTER TABLE public.ledger_category ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_category_org_isolation" ON public.ledger_category;
CREATE POLICY "ledger_category_org_isolation" ON public.ledger_category
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_expense ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_expense_org_isolation" ON public.ledger_expense;
CREATE POLICY "ledger_expense_org_isolation" ON public.ledger_expense
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_expense_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_expense_item_org_isolation" ON public.ledger_expense_item;
CREATE POLICY "ledger_expense_item_org_isolation" ON public.ledger_expense_item
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_budget_org_isolation" ON public.ledger_budget;
CREATE POLICY "ledger_budget_org_isolation" ON public.ledger_budget
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_line_channel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_line_channel_org_isolation" ON public.ledger_line_channel;
CREATE POLICY "ledger_line_channel_org_isolation" ON public.ledger_line_channel
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.ledger_export_batch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_export_batch_org_isolation" ON public.ledger_export_batch;
CREATE POLICY "ledger_export_batch_org_isolation" ON public.ledger_export_batch
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- RPC — next document code per (org, company). Atomic-ish per-month counter.
-- Format: EXP-YYYYMM-NNNN  (e.g. EXP-202606-0001) — pattern of repair_next_ticket_code.
-- Numbering resets each calendar month, scoped per company.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ledger_next_doc_code(p_org uuid, p_company uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yyyymm TEXT;
  v_count  INT;
  v_code   TEXT;
BEGIN
  v_yyyymm := to_char(NOW(), 'YYYYMM');

  -- NOTE: Postgres rejects FOR UPDATE on an aggregate (COUNT) query, so we
  -- serialize concurrent counter reads with a transaction-scoped advisory lock
  -- keyed on (org, company, month) instead. Two inserts for the SAME company in
  -- the SAME month queue behind this lock → no duplicate NNNN, no collision on
  -- the unique(org, company, doc_code) constraint. The lock auto-releases at
  -- COMMIT (the caller's create runs in the same tx). Mirrors the COUNT(*)+1
  -- numbering of repair_next_ticket_code (which has no FOR UPDATE).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_org::text || ':' || p_company::text || ':' || v_yyyymm, 0)
  );

  SELECT COUNT(*) + 1
    INTO v_count
    FROM public.ledger_expense
   WHERE org_id = p_org
     AND company_id = p_company
     AND doc_code LIKE 'EXP-' || v_yyyymm || '-%';

  v_code := 'EXP-' || v_yyyymm || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ledger_next_doc_code(uuid, uuid) TO authenticated, anon, service_role;

-- ============================================================
-- Seed — default expense categories per active org × company (idempotent)
-- 12 proposed categories (เจพีซิ้งค์ กรุ๊ป — แก้ได้ภายหลัง). Safe to re-run.
-- NOTE: company "JP Sync Group" (code JPSYNC) already created by prisma/seed.ts.
--       trcloud_company_id=45 mapping is recorded in companies.settings by the
--       parent/CEO step (see docs/LEDGER_SETUP.md) — not enforced here.
-- ============================================================
INSERT INTO public.ledger_category (id, org_id, company_id, name, kind, color, sort, active, created_at, updated_at)
SELECT gen_random_uuid(), c.org_id, c.id, cat.name, 'expense', cat.color, cat.sort, true, NOW(), NOW()
FROM public.companies c
CROSS JOIN (
  VALUES
    ('เงินเดือน/ค่าแรง',            '#2563EB', 10),
    ('ค่าวัตถุดิบ/สินค้า',          '#0EA5E9', 20),
    ('ค่าเช่า',                     '#7C3AED', 30),
    ('ค่าน้ำ-ไฟ-เน็ต',             '#F59E0B', 40),
    ('ค่าน้ำมัน/ขนส่ง',            '#EF4444', 50),
    ('ค่าการตลาด/โฆษณา',          '#EC4899', 60),
    ('ค่าซ่อมบำรุง',               '#10B981', 70),
    ('อุปกรณ์/เครื่องใช้สำนักงาน',  '#6366F1', 80),
    ('ค่าบริการ/ค่าธรรมเนียม',      '#14B8A6', 90),
    ('ภาษี/ค่าธรรมเนียมราชการ',    '#64748B', 100),
    ('ค่ารับรอง',                   '#F97316', 110),
    ('เบ็ดเตล็ด/จิปาถะ',           '#94A3B8', 120)
) AS cat(name, color, sort)
WHERE c.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_category lc
    WHERE lc.org_id = c.org_id AND lc.company_id = c.id AND lc.name = cat.name
  );

-- ============================================================
-- Verification (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename LIKE 'ledger_%';   -- all 6 → true
--
--   SELECT public.ledger_next_doc_code(
--     (SELECT id FROM organizations LIMIT 1),
--     (SELECT id FROM companies LIMIT 1));                      -- EXP-YYYYMM-0001
--
--   SELECT name FROM ledger_category ORDER BY sort LIMIT 12;    -- 12 per company
