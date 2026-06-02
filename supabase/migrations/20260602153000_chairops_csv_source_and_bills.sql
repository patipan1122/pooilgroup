-- =============================================================
-- ChairOps F1 (CSV import maid collections) + F2 (vendor bills matrix)
-- 2026-06-02 · audit MISS-01 (vendor bills) + MISS-04 (maid CSV)
-- =============================================================
-- This migration:
--   (a) Adds enum chairops."CollectionSource" (MAID_MANUAL, CSV_IMPORT, OFFICE_PROXY)
--   (b) Extends chairops."ChairopsCashCollection":
--        - add "source" column (default MAID_MANUAL)
--        - add "importedById" column (nullable, who pasted/uploaded the CSV)
--        - drop NOT NULL on "evidencePhotoUrl" and "imageHash"
--        - CHECK: MAID_MANUAL still requires evidencePhotoUrl + imageHash
--   (c) Creates chairops."chairops_expense_category" (11 default rows per org)
--   (d) Creates chairops."chairops_vendor_bill" (one row per branch+month+category)
--
-- CEO decisions locked (2026-06-02):
--   F1 evidencePhotoUrl optional for CSV_IMPORT, required for MAID_MANUAL
--   F2 11 default categories: RENT/ELECTRIC/WATER/TAX/INTERNET/STAFF/CLEAN/
--      SECURITY/MARKETING_FEE/DEPOSIT/OTHER (user can CRUD afterwards)
--   F2 paid status = 3-state (PENDING / PAID / OVERDUE) — OVERDUE auto-derived
--      at read time from (dueDate < today AND paidAt IS NULL)
--   F2 bank account per-bill (free-text "bankAccountTo" not FK)
--   F2 recurring NOT auto · accountant enters from email · ±20% anomaly check
--      lives in app logic (compares to prior month same category+branch)
--   F2 permissions: CEO+ADMIN do all · MANAGER+OFFICE view only · MAID no access
--      (enforced by RLS + app guard · this migration only adds the tables)
--
-- DO NOT APPLY directly · classifier blocks prod DB writes ·
-- CEO runs `supabase db push` manually after this PR ships.
-- =============================================================

BEGIN;

SET search_path = chairops, public;

-- -------------------------------------------------------------
-- (a) enum CollectionSource
-- -------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CollectionSource' AND n.nspname = 'chairops'
  ) THEN
    CREATE TYPE chairops."CollectionSource" AS ENUM (
      'MAID_MANUAL',
      'CSV_IMPORT',
      'OFFICE_PROXY'
    );
  END IF;
END $$;

-- -------------------------------------------------------------
-- (b) extend ChairopsCashCollection — source + importedById + nullable photos
-- -------------------------------------------------------------
ALTER TABLE chairops."ChairopsCashCollection"
  ADD COLUMN IF NOT EXISTS "source"        chairops."CollectionSource" NOT NULL DEFAULT 'MAID_MANUAL',
  ADD COLUMN IF NOT EXISTS "importedById"  TEXT;

ALTER TABLE chairops."ChairopsCashCollection"
  ALTER COLUMN "evidencePhotoUrl" DROP NOT NULL,
  ALTER COLUMN "imageHash"        DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_source_idx"
  ON chairops."ChairopsCashCollection" ("source");
CREATE INDEX IF NOT EXISTS "ChairopsCashCollection_importedById_idx"
  ON chairops."ChairopsCashCollection" ("importedById")
  WHERE "importedById" IS NOT NULL;

-- CHECK · MAID_MANUAL rows must keep evidencePhotoUrl + imageHash populated.
-- CSV_IMPORT and OFFICE_PROXY may leave them NULL (no maid photo at office desk).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ChairopsCashCollection_maid_manual_requires_photo'
  ) THEN
    ALTER TABLE chairops."ChairopsCashCollection"
      ADD CONSTRAINT "ChairopsCashCollection_maid_manual_requires_photo"
      CHECK (
        "source" <> 'MAID_MANUAL'
        OR ("evidencePhotoUrl" IS NOT NULL AND "imageHash" IS NOT NULL)
      );
  END IF;
END $$;

-- -------------------------------------------------------------
-- (c) chairops_expense_category — user-editable list of bill categories
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."chairops_expense_category" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"      TEXT         NOT NULL,
  "code"       TEXT         NOT NULL,
  "label"      TEXT         NOT NULL,
  "sortOrder"  INTEGER      NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "chairops_expense_category_orgId_code_key"
  ON chairops."chairops_expense_category" ("orgId", "code");
CREATE INDEX IF NOT EXISTS "chairops_expense_category_orgId_sortOrder_idx"
  ON chairops."chairops_expense_category" ("orgId", "sortOrder");

-- Seed 11 default categories for the Pooilgroup org (only if not present).
-- Idempotent · ON CONFLICT DO NOTHING on (orgId, code).
DO $$
DECLARE
  v_org_id TEXT;
BEGIN
  SELECT id::text INTO v_org_id FROM public.organizations WHERE slug = 'pooilgroup' LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization slug=pooilgroup · skipping default category seed';
  ELSE
    INSERT INTO chairops."chairops_expense_category" ("orgId", "code", "label", "sortOrder")
    VALUES
      (v_org_id, 'RENT',           'ค่าเช่าห้าง',        10),
      (v_org_id, 'ELECTRIC',       'ค่าไฟ',              20),
      (v_org_id, 'WATER',          'ค่าน้ำ',             30),
      (v_org_id, 'TAX',            'ค่าภาษี',            40),
      (v_org_id, 'INTERNET',       'ค่าอินเทอร์เน็ต',     50),
      (v_org_id, 'STAFF',          'ค่าจ้างพนักงาน',     60),
      (v_org_id, 'CLEAN',          'ค่าทำความสะอาด',     70),
      (v_org_id, 'SECURITY',       'ค่ารปภ.',            80),
      (v_org_id, 'MARKETING_FEE',  'ค่าโปรโมชั่นห้าง',    90),
      (v_org_id, 'DEPOSIT',        'เงินประกัน',         100),
      (v_org_id, 'OTHER',          'อื่น ๆ',              999)
    ON CONFLICT ("orgId", "code") DO NOTHING;
  END IF;
END $$;

-- -------------------------------------------------------------
-- (d) chairops_vendor_bill — one row per branch+month+category
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."chairops_vendor_bill" (
  "id"             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"          TEXT           NOT NULL,
  "branchId"       TEXT           NOT NULL,
  "billPeriod"     DATE           NOT NULL,           -- 1st of month
  "categoryId"     UUID           NOT NULL,
  "amount"         NUMERIC(12, 2) NOT NULL,
  "dueDate"        DATE           NOT NULL,
  "paidAt"         TIMESTAMP(3),
  "paidAmount"     NUMERIC(12, 2),
  "slipPhotoUrl"   TEXT,
  "bankAccountTo"  TEXT,
  "paymentTerms"   TEXT,
  "notes"          TEXT,
  "createdById"    TEXT           NOT NULL,
  "updatedById"    TEXT           NOT NULL,
  "createdAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chairops_vendor_bill_billPeriod_first_of_month_chk"
    CHECK (EXTRACT(DAY FROM "billPeriod") = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "chairops_vendor_bill_uniq_branch_period_category"
  ON chairops."chairops_vendor_bill" ("orgId", "branchId", "billPeriod", "categoryId");
CREATE INDEX IF NOT EXISTS "chairops_vendor_bill_orgId_dueDate_idx"
  ON chairops."chairops_vendor_bill" ("orgId", "dueDate");
CREATE INDEX IF NOT EXISTS "chairops_vendor_bill_branchId_billPeriod_idx"
  ON chairops."chairops_vendor_bill" ("branchId", "billPeriod" DESC);
CREATE INDEX IF NOT EXISTS "chairops_vendor_bill_orgId_paidAt_idx"
  ON chairops."chairops_vendor_bill" ("orgId", "paidAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chairops_vendor_bill_branchId_fkey'
  ) THEN
    ALTER TABLE chairops."chairops_vendor_bill"
      ADD CONSTRAINT "chairops_vendor_bill_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES chairops."ChairopsBranch"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chairops_vendor_bill_categoryId_fkey'
  ) THEN
    ALTER TABLE chairops."chairops_vendor_bill"
      ADD CONSTRAINT "chairops_vendor_bill_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES chairops."chairops_expense_category"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
