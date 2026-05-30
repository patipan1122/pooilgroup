-- 2026-05-30 — Cash deposit table + per-chair breakdown
--
-- CEO requirement: maid Step 1 must list ALL chairs of the branch (checklist)
-- with per-chair amount/status/photo; Step 2 deposit may BATCH multiple
-- collection rounds into one bank trip (saves fees + bank queue time) plus a
-- bankFee field. Architecture switch:
--
--   ChairopsCashCollection now has chair_breakdown (JSONB) and deposit_id
--   (FK to new table). depositedAmount + slipPhotoUrl are deprecated but
--   kept nullable for legacy rows.
--
--   ChairopsCashDeposit is the new bank-trip row — one per actual deposit,
--   referenced by 1+ collections.

SET search_path = chairops, public;

-- 1) cash_collections: add chair_breakdown + deposit_id + index
ALTER TABLE chairops.cash_collections
  ADD COLUMN IF NOT EXISTS chair_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS deposit_id UUID,
  ALTER COLUMN deposited_amount SET DEFAULT 0;

-- Existing NOT NULL on deposited_amount stays — legacy rows already have a
-- value. New rows from app code pass 0 explicitly.

CREATE INDEX IF NOT EXISTS cash_collections_branch_deposit_idx
  ON chairops.cash_collections (branch_id, deposit_id);

-- 2) cash_deposits: new table
CREATE TABLE IF NOT EXISTS chairops.cash_deposits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL,
  branch_id        UUID NOT NULL,
  maid_id          UUID NOT NULL,
  deposited_at     TIMESTAMP(6) NOT NULL DEFAULT now(),
  deposited_amount INTEGER NOT NULL,
  bank_fee         INTEGER NOT NULL DEFAULT 0,
  slip_photo_url   TEXT NOT NULL,
  slip_image_hash  TEXT NOT NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT cash_deposits_org_slip_uk UNIQUE (org_id, slip_image_hash)
);

CREATE INDEX IF NOT EXISTS cash_deposits_org_idx
  ON chairops.cash_deposits (org_id);
CREATE INDEX IF NOT EXISTS cash_deposits_branch_at_idx
  ON chairops.cash_deposits (branch_id, deposited_at);
CREATE INDEX IF NOT EXISTS cash_deposits_maid_at_idx
  ON chairops.cash_deposits (maid_id, deposited_at);

-- FK from collection → deposit (added after table exists)
ALTER TABLE chairops.cash_collections
  ADD CONSTRAINT cash_collections_deposit_fk
  FOREIGN KEY (deposit_id) REFERENCES chairops.cash_deposits (id)
  ON DELETE SET NULL;

-- FK from deposit → branch / maid (mirror existing collection FKs)
ALTER TABLE chairops.cash_deposits
  ADD CONSTRAINT cash_deposits_branch_fk
  FOREIGN KEY (branch_id) REFERENCES chairops.branches (id);

ALTER TABLE chairops.cash_deposits
  ADD CONSTRAINT cash_deposits_maid_fk
  FOREIGN KEY (maid_id) REFERENCES chairops.users (id);
