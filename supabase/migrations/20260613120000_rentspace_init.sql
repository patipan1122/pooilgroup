-- RentSpace — ระบบบริหารโครงการร้านค้าเช่า (module slug `rentspace`)
-- 2026-06-13 · 14 tables + 8 enums + module registration
-- Apply: psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260613120000_rentspace_init.sql
-- Idempotent-ish: uses IF NOT EXISTS / DO blocks where possible.

-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public."RentalUnitStatus" AS ENUM ('vacant', 'occupied', 'reserved', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalContractStatus" AS ENUM ('draft', 'active', 'expiring', 'expired', 'terminated');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalBillStatus" AS ENUM ('draft', 'issued', 'partial', 'paid', 'overdue', 'void');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalMeterKind" AS ENUM ('electric', 'water');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalDepositKind" AS ENUM ('collect', 'refund', 'deduct', 'forfeit');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalDiscountStatus" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalLateFeeType" AS ENUM ('none', 'fixed', 'percent_total', 'per_day');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE public."RentalDiscountKind" AS ENUM ('amount', 'percent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS public.rental_project (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL,
  company_id          UUID,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  address             TEXT,
  description         TEXT,
  plan_image_url      TEXT,
  view_3d_enabled     BOOLEAN NOT NULL DEFAULT true,
  electric_rate       DECIMAL(10,2) NOT NULL DEFAULT 7,
  water_rate          DECIMAL(10,2) NOT NULL DEFAULT 18,
  vat_percent         DECIMAL(5,2) NOT NULL DEFAULT 0,
  late_fee_type       public."RentalLateFeeType" NOT NULL DEFAULT 'none',
  late_fee_value      DECIMAL(15,2) NOT NULL DEFAULT 0,
  late_fee_grace_days INTEGER NOT NULL DEFAULT 7,
  bill_due_day        INTEGER NOT NULL DEFAULT 5,
  auto_bill_enabled   BOOLEAN NOT NULL DEFAULT true,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_project_org_id_slug_key ON public.rental_project(org_id, slug);
CREATE INDEX IF NOT EXISTS rental_project_org_id_is_active_idx ON public.rental_project(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.rental_tenant (
  id           UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  prefix       TEXT,
  first_name   TEXT,
  last_name    TEXT,
  nickname     TEXT,
  biz_name     TEXT,
  phones       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  id_card_no   TEXT,
  tax_id       TEXT,
  birth_date   DATE,
  nationality  TEXT,
  address      TEXT,
  email        TEXT,
  facebook     TEXT,
  line_id      TEXT,
  id_card_url  TEXT,
  doc_urls     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  note         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_tenant_org_id_is_active_idx ON public.rental_tenant(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.rental_contract_template (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL,
  name        TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_contract_template_org_id_is_active_idx ON public.rental_contract_template(org_id, is_active);

CREATE TABLE IF NOT EXISTS public.rental_unit (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  project_id    UUID NOT NULL REFERENCES public.rental_project(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT,
  building      TEXT,
  floor         INTEGER,
  zone          TEXT,
  area_sqm      DECIMAL(10,2),
  base_rent_thb DECIMAL(15,2) NOT NULL DEFAULT 0,
  status        public."RentalUnitStatus" NOT NULL DEFAULT 'vacant',
  map_x         DECIMAL(7,3),
  map_y         DECIMAL(7,3),
  map_w         DECIMAL(7,3),
  map_h         DECIMAL(7,3),
  map_color     TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_unit_project_id_code_key ON public.rental_unit(project_id, code);
CREATE INDEX IF NOT EXISTS rental_unit_org_id_project_id_status_idx ON public.rental_unit(org_id, project_id, status);

CREATE TABLE IF NOT EXISTS public.rental_contract (
  id                  UUID PRIMARY KEY,
  org_id              UUID NOT NULL,
  project_id          UUID NOT NULL REFERENCES public.rental_project(id) ON DELETE CASCADE,
  unit_id             UUID NOT NULL REFERENCES public.rental_unit(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES public.rental_tenant(id) ON DELETE RESTRICT,
  template_id         UUID REFERENCES public.rental_contract_template(id) ON DELETE SET NULL,
  contract_no         TEXT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE,
  rent_amount_thb     DECIMAL(15,2) NOT NULL DEFAULT 0,
  rent_due_day        INTEGER NOT NULL DEFAULT 5,
  deposit_amount_thb  DECIMAL(15,2) NOT NULL DEFAULT 0,
  deposit_months      DECIMAL(5,2) NOT NULL DEFAULT 0,
  vat_percent         DECIMAL(5,2) NOT NULL DEFAULT 0,
  electric_rate       DECIMAL(10,2),
  water_rate          DECIMAL(10,2),
  late_fee_type       public."RentalLateFeeType" NOT NULL DEFAULT 'none',
  late_fee_value      DECIMAL(15,2) NOT NULL DEFAULT 0,
  late_fee_grace_days INTEGER NOT NULL DEFAULT 7,
  rent_schedule       JSONB,
  custom_terms_html   TEXT,
  status              public."RentalContractStatus" NOT NULL DEFAULT 'draft',
  sign_token          TEXT,
  signed_at           TIMESTAMPTZ(6),
  tenant_signed       BOOLEAN NOT NULL DEFAULT false,
  signature_data_url  TEXT,
  signer_name         TEXT,
  contract_pdf_url    TEXT,
  note                TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_contract_org_id_contract_no_key ON public.rental_contract(org_id, contract_no);
CREATE UNIQUE INDEX IF NOT EXISTS rental_contract_sign_token_key ON public.rental_contract(sign_token);
CREATE INDEX IF NOT EXISTS rental_contract_org_id_project_id_status_idx ON public.rental_contract(org_id, project_id, status);
CREATE INDEX IF NOT EXISTS rental_contract_org_id_unit_id_status_idx ON public.rental_contract(org_id, unit_id, status);

CREATE TABLE IF NOT EXISTS public.rental_deposit (
  id           UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  contract_id  UUID NOT NULL REFERENCES public.rental_contract(id) ON DELETE CASCADE,
  kind         public."RentalDepositKind" NOT NULL,
  amount_thb   DECIMAL(15,2) NOT NULL,
  occurred_on  DATE NOT NULL,
  method       TEXT,
  slip_url     TEXT,
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_deposit_org_id_contract_id_idx ON public.rental_deposit(org_id, contract_id);

CREATE TABLE IF NOT EXISTS public.rental_meter (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL,
  unit_id         UUID NOT NULL REFERENCES public.rental_unit(id) ON DELETE CASCADE,
  kind            public."RentalMeterKind" NOT NULL,
  meter_no        TEXT,
  initial_reading DECIMAL(15,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_meter_unit_id_kind_key ON public.rental_meter(unit_id, kind);
CREATE INDEX IF NOT EXISTS rental_meter_org_id_unit_id_idx ON public.rental_meter(org_id, unit_id);

CREATE TABLE IF NOT EXISTS public.rental_meter_reading (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  unit_id       UUID NOT NULL REFERENCES public.rental_unit(id) ON DELETE CASCADE,
  meter_id      UUID NOT NULL REFERENCES public.rental_meter(id) ON DELETE CASCADE,
  kind          public."RentalMeterKind" NOT NULL,
  period        TEXT NOT NULL,
  prev_reading  DECIMAL(15,2) NOT NULL DEFAULT 0,
  curr_reading  DECIMAL(15,2) NOT NULL DEFAULT 0,
  usage         DECIMAL(15,2) NOT NULL DEFAULT 0,
  rate_per_unit DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_thb    DECIMAL(15,2) NOT NULL DEFAULT 0,
  photo_url     TEXT,
  note          TEXT,
  read_by       UUID,
  read_at       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_meter_reading_meter_id_period_key ON public.rental_meter_reading(meter_id, period);
CREATE INDEX IF NOT EXISTS rental_meter_reading_org_id_unit_id_period_idx ON public.rental_meter_reading(org_id, unit_id, period);

CREATE TABLE IF NOT EXISTS public.rental_bill (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL,
  project_id      UUID NOT NULL REFERENCES public.rental_project(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES public.rental_unit(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES public.rental_contract(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.rental_tenant(id) ON DELETE RESTRICT,
  bill_no         TEXT NOT NULL,
  period          TEXT NOT NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          public."RentalBillStatus" NOT NULL DEFAULT 'draft',
  rent_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  electric_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  water_amount    DECIMAL(15,2) NOT NULL DEFAULT 0,
  other_amount    DECIMAL(15,2) NOT NULL DEFAULT 0,
  late_fee_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal        DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  note            TEXT,
  pdf_url         TEXT,
  auto_generated  BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_bill_contract_id_period_key ON public.rental_bill(contract_id, period);
CREATE UNIQUE INDEX IF NOT EXISTS rental_bill_org_id_bill_no_key ON public.rental_bill(org_id, bill_no);
CREATE INDEX IF NOT EXISTS rental_bill_org_id_project_id_status_idx ON public.rental_bill(org_id, project_id, status);
CREATE INDEX IF NOT EXISTS rental_bill_org_id_status_due_date_idx ON public.rental_bill(org_id, status, due_date);

CREATE TABLE IF NOT EXISTS public.rental_bill_item (
  id         UUID PRIMARY KEY,
  bill_id    UUID NOT NULL REFERENCES public.rental_bill(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  qty        DECIMAL(15,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rental_bill_item_bill_id_idx ON public.rental_bill_item(bill_id);

CREATE TABLE IF NOT EXISTS public.rental_payment (
  id           UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  bill_id      UUID NOT NULL REFERENCES public.rental_bill(id) ON DELETE CASCADE,
  contract_id  UUID NOT NULL,
  amount_thb   DECIMAL(15,2) NOT NULL,
  paid_on      DATE NOT NULL,
  method       TEXT NOT NULL DEFAULT 'transfer',
  reference    TEXT,
  slip_url     TEXT,
  note         TEXT,
  received_by  UUID,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_payment_org_id_bill_id_idx ON public.rental_payment(org_id, bill_id);
CREATE INDEX IF NOT EXISTS rental_payment_org_id_contract_id_idx ON public.rental_payment(org_id, contract_id);

CREATE TABLE IF NOT EXISTS public.rental_discount (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL,
  bill_id         UUID NOT NULL REFERENCES public.rental_bill(id) ON DELETE CASCADE,
  kind            public."RentalDiscountKind" NOT NULL,
  value           DECIMAL(15,2) NOT NULL,
  computed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  reason          TEXT,
  status          public."RentalDiscountStatus" NOT NULL DEFAULT 'pending',
  requested_by    UUID,
  decided_by      UUID,
  decided_at      TIMESTAMPTZ(6),
  decision_note   TEXT,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_discount_org_id_bill_id_idx ON public.rental_discount(org_id, bill_id);
CREATE INDEX IF NOT EXISTS rental_discount_org_id_status_idx ON public.rental_discount(org_id, status);

CREATE TABLE IF NOT EXISTS public.rental_document (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL,
  owner_type  TEXT NOT NULL,
  owner_id    UUID NOT NULL,
  label       TEXT,
  url         TEXT NOT NULL,
  mime        TEXT,
  size_bytes  INTEGER,
  uploaded_by UUID,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rental_document_org_id_owner_idx ON public.rental_document(org_id, owner_type, owner_id);

-- ============ MODULE REGISTRATION ============
-- Sync user_modules.module_name CHECK with lib/modules.ts (add 'rentspace')
ALTER TABLE public.user_modules DROP CONSTRAINT IF EXISTS user_modules_module_name_check;
ALTER TABLE public.user_modules ADD CONSTRAINT user_modules_module_name_check
  CHECK (module_name IN (
    'cashhub','fuelos','docuflow','recruit','repairs','clawfleet',
    'chairops','playland','inbox','costctrl','hotelbook','ledger','rentspace'
  ));

-- Enable module for Pooilgroup org
INSERT INTO public.org_modules (id, org_id, module_name, is_active, activated_at)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'rentspace', true, CURRENT_TIMESTAMP)
ON CONFLICT (org_id, module_name) DO UPDATE SET is_active = true;
