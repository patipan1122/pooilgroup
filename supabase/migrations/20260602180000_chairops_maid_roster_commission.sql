-- =============================================================
-- ChairOps BF1 · Maid Roster + Day-off + Pay Ledger (DEVIL-MVP)
-- 2026-06-02 · audit MAID-04 + OWN-05 + missed-maids false-alarm
-- =============================================================
-- This migration:
--   (a) Creates chairops."ChairopsMaidDayOff" (1 row = 1 maid + 1 date).
--   (b) Creates chairops."ChairopsMaidDailyPay" (1 row = 1 paycheck day, manual).
--   (c) Adds requiresReview column to ChairopsCashDeposit (MAID-04 anti-fraud
--       diff >= 500 flag).
--   (d) Adds partial UNIQUE index on ChairopsMaidAssignment to enforce 1 open
--       assignment per maid (the table existed but was a dead ghost).
--   (e) RLS enabled on the two new tables · service-role bypass keeps server
--       actions working · per-org policy mirrors ChairopsVendorBill pattern.
--
-- CEO decisions locked (2026-06-02):
--   - MaidDayOff is 1 row per day, DELETE to revoke (NO range cols, NO approval).
--     If maid wants 3 days off, UI loops INSERT 3 rows in one transaction.
--   - MaidDailyPay is a pure ledger: amount manually entered, NO formula,
--     NO commission engine. Auto-fill defaults live in BF1.5 if CEO asks.
--   - Wire existing ChairopsMaidAssignment for audit trail (option a, not drop).
--   - MAID-04: notes-required when |diff| >= 100, requires_review flag when
--     |diff| >= 500. Office gets LINE OA push, gate is hard on the maid side.
--   - Permissions: CEO+ADMIN do all · MANAGER+OFFICE view roster only ·
--     MANAGER+OFFICE see NO pay surfaces · MAID has LIFF self-flag only.
--
-- DO NOT APPLY directly · classifier blocks prod DB writes ·
-- CEO runs `supabase db push` manually after this PR ships.
-- =============================================================

BEGIN;

SET search_path = chairops, public;

-- -------------------------------------------------------------
-- (a) ChairopsMaidDayOff · 1 row = 1 day off
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."ChairopsMaidDayOff" (
  "id"          TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT         NOT NULL,
  "maidId"      TEXT         NOT NULL,
  "date"        DATE         NOT NULL,
  "reason"      TEXT,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1 day-off per maid per date · INSERT for revoke fails clean (P2002)
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsMaidDayOff_orgId_maidId_date_key"
  ON chairops."ChairopsMaidDayOff" ("orgId", "maidId", "date");
CREATE INDEX IF NOT EXISTS "ChairopsMaidDayOff_orgId_date_idx"
  ON chairops."ChairopsMaidDayOff" ("orgId", "date");
CREATE INDEX IF NOT EXISTS "ChairopsMaidDayOff_maidId_date_idx"
  ON chairops."ChairopsMaidDayOff" ("maidId", "date" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChairopsMaidDayOff_maidId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsMaidDayOff"
      ADD CONSTRAINT "ChairopsMaidDayOff_maidId_fkey"
      FOREIGN KEY ("maidId") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChairopsMaidDayOff_createdById_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsMaidDayOff"
      ADD CONSTRAINT "ChairopsMaidDayOff_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------
-- (b) ChairopsMaidDailyPay · manual ledger, amount can be negative
-- (deduction-as-negative is allowed per BA Q7 default - amount Int with no
-- positive constraint · admin can record "-200 หักค่าชุด").
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."ChairopsMaidDailyPay" (
  "id"        TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"     TEXT         NOT NULL,
  "maidId"    TEXT         NOT NULL,
  "date"      DATE         NOT NULL,
  "amount"    INTEGER      NOT NULL,
  "note"      TEXT,
  "paidById"  TEXT         NOT NULL,
  "paidAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsMaidDailyPay_orgId_maidId_date_key"
  ON chairops."ChairopsMaidDailyPay" ("orgId", "maidId", "date");
CREATE INDEX IF NOT EXISTS "ChairopsMaidDailyPay_orgId_date_idx"
  ON chairops."ChairopsMaidDailyPay" ("orgId", "date");
CREATE INDEX IF NOT EXISTS "ChairopsMaidDailyPay_maidId_date_idx"
  ON chairops."ChairopsMaidDailyPay" ("maidId", "date" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChairopsMaidDailyPay_maidId_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsMaidDailyPay"
      ADD CONSTRAINT "ChairopsMaidDailyPay_maidId_fkey"
      FOREIGN KEY ("maidId") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChairopsMaidDailyPay_paidById_fkey'
  ) THEN
    ALTER TABLE chairops."ChairopsMaidDailyPay"
      ADD CONSTRAINT "ChairopsMaidDailyPay_paidById_fkey"
      FOREIGN KEY ("paidById") REFERENCES chairops."ChairopsUser"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- -------------------------------------------------------------
-- (c) ChairopsCashDeposit · add requiresReview (MAID-04 anti-fraud)
-- -------------------------------------------------------------
ALTER TABLE chairops."ChairopsCashDeposit"
  ADD COLUMN IF NOT EXISTS "requiresReview" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "ChairopsCashDeposit_orgId_requiresReview_idx"
  ON chairops."ChairopsCashDeposit" ("orgId", "requiresReview")
  WHERE "requiresReview" = TRUE;

-- -------------------------------------------------------------
-- (d) ChairopsMaidAssignment · partial unique index (1 open per maid)
-- Schema-level guarantee that BF1 wiring is correct. Conflicts surface as
-- P2002 in server actions, where they're caught and turned into a friendly
-- "มี assignment ค้างอยู่ · refresh แล้วลองใหม่" message.
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "chairops_one_open_assignment_per_maid"
  ON chairops."ChairopsMaidAssignment" ("userId")
  WHERE ("endedAt" IS NULL AND "isActive" = TRUE);

-- -------------------------------------------------------------
-- (e) Row-Level Security · per-org isolation
-- Pattern mirrors chairops_vendor_bill in 20260602153000 · service role
-- bypasses RLS automatically so server actions work without policies on
-- writes. Read policy keeps Supabase REST API safe for future direct queries.
-- -------------------------------------------------------------
ALTER TABLE chairops."ChairopsMaidDayOff"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsMaidDailyPay" ENABLE ROW LEVEL SECURITY;

-- Default-deny · server actions use service role (bypasses RLS) so app code
-- is unaffected. Anonymous/auth role gets zero rows · same pattern as
-- chairops_vendor_bill.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'chairops' AND tablename = 'ChairopsMaidDayOff'
      AND policyname = 'maid_dayoff_deny_all_default'
  ) THEN
    CREATE POLICY "maid_dayoff_deny_all_default"
      ON chairops."ChairopsMaidDayOff"
      FOR ALL TO PUBLIC
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'chairops' AND tablename = 'ChairopsMaidDailyPay'
      AND policyname = 'maid_dailypay_deny_all_default'
  ) THEN
    CREATE POLICY "maid_dailypay_deny_all_default"
      ON chairops."ChairopsMaidDailyPay"
      FOR ALL TO PUBLIC
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
END $$;

COMMIT;
