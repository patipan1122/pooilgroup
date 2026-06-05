-- ChairOps Maid Management — 9-feature migration
-- F4: self-onboarding (5 fields) · F5: invite token persist · F7: deactivation reason · F8: LINE block · S1: cover branch

-- New enum: offboarding reason
CREATE TYPE "chairops"."OffboardingReason" AS ENUM ('RESIGNED', 'TERMINATED', 'TRANSFERRED', 'OTHER');

-- New columns on ChairopsUser
ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS invite_token          TEXT        UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_phone          TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact     TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone       TEXT,
  ADD COLUMN IF NOT EXISTS current_main_employer TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_complete   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deactivated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by_id     UUID,
  ADD COLUMN IF NOT EXISTS offboarding_reason    "chairops"."OffboardingReason",
  ADD COLUMN IF NOT EXISTS offboarding_note      TEXT,
  ADD COLUMN IF NOT EXISTS secondary_branch_id   UUID;

-- Backfill: existing maids who already bound LINE must NOT be locked out by onboarding gate
UPDATE chairops."ChairopsUser"
  SET onboarding_complete = TRUE
  WHERE role = 'MAID' AND line_user_id IS NOT NULL;
