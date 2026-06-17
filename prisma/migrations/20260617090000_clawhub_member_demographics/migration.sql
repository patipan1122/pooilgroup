-- ClawHub (JOLLY PLAY) — member demographics.
-- ADDITIVE + IDEMPOTENT: the module is live; this only adds two nullable columns to an
-- existing table, so it is safe to run on production and safe to re-run (IF NOT EXISTS).
-- No data backfill, no drops, no NOT NULL.

-- Registration now collects birthday (for age) + gender.
ALTER TABLE "public"."clawhub_members"
  ADD COLUMN IF NOT EXISTS "birth_date" DATE,
  ADD COLUMN IF NOT EXISTS "gender" TEXT;
