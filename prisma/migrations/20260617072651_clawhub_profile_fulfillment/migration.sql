-- ClawHub (JOLLY PLAY) — profile + fulfillment fields.
-- ADDITIVE + IDEMPOTENT: the module is live; this only adds nullable columns and a new
-- enum, so it is safe to run on production and safe to re-run (IF NOT EXISTS / guarded
-- enum create). No data backfill, no drops, no NOT NULL.

-- New fulfillment-method enum (guard against re-run: duplicate_object → no-op).
DO $$ BEGIN
  CREATE TYPE "public"."ClawhubFulfillMethod" AS ENUM ('DELIVERY', 'PICKUP', 'CONTACT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1) Registration profile: full name + address (phone + display_name already exist).
ALTER TABLE "public"."clawhub_members"
  ADD COLUMN IF NOT EXISTS "full_name" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT;

-- 2) Refund: typed 7-Eleven branch code (+ optional name). Photo NOT OCR'd for branch.
ALTER TABLE "public"."clawhub_refund_requests"
  ADD COLUMN IF NOT EXISTS "store_branch_code" TEXT,
  ADD COLUMN IF NOT EXISTS "store_branch_name" TEXT;

-- 3) Redemption: fulfillment choice (DELIVERY / PICKUP / CONTACT) + its fields.
ALTER TABLE "public"."clawhub_redemptions"
  ADD COLUMN IF NOT EXISTS "fulfill_method" "public"."ClawhubFulfillMethod",
  ADD COLUMN IF NOT EXISTS "recipient_name" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_address" TEXT,
  ADD COLUMN IF NOT EXISTS "pickup_branch_code" TEXT,
  ADD COLUMN IF NOT EXISTS "pickup_time" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_note" TEXT;
