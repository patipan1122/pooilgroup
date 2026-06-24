-- DC wave-B redesign migration (ADDITIVE · hand-written to avoid migrate-diff drift trap)
-- Apply to prod with: prisma db execute --file <this> (DIRECT_URL) · CEO-approved.
-- Safe: only ADDs to dc schema. Touches NO other schema. Idempotent guards throughout.

-- 1. PO origin (จีน/ไทย)
DO $$ BEGIN
  CREATE TYPE "dc"."DcPoOrigin" AS ENUM ('CHINA', 'THAI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "dc"."purchase_orders"
  ADD COLUMN IF NOT EXISTS "origin" "dc"."DcPoOrigin" NOT NULL DEFAULT 'CHINA';

-- 2. New PO statuses (สั่ง→ได้ tracking→ถึงไทย→ถึงโกดัง→รับแล้ว)
ALTER TYPE "dc"."DcPoStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "dc"."DcPoStatus" ADD VALUE IF NOT EXISTS 'ARRIVED_TH';
ALTER TYPE "dc"."DcPoStatus" ADD VALUE IF NOT EXISTS 'AT_WAREHOUSE';
ALTER TYPE "dc"."DcPoStatus" ADD VALUE IF NOT EXISTS 'RECEIVED';

-- 3. Box dimensions on shipments (ขนาดต่อกล่อง → CBM)
ALTER TABLE "dc"."shipments" ADD COLUMN IF NOT EXISTS "length_cm" DECIMAL(10,2);
ALTER TABLE "dc"."shipments" ADD COLUMN IF NOT EXISTS "width_cm"  DECIMAL(10,2);
ALTER TABLE "dc"."shipments" ADD COLUMN IF NOT EXISTS "height_cm" DECIMAL(10,2);

-- 4. FX daily-rate cache (CNY→THB จาก fawazahmed0/currency-api)
CREATE TABLE IF NOT EXISTS "dc"."fx_rates" (
  "id"         UUID PRIMARY KEY,
  "rate_date"  DATE NOT NULL,
  "base_ccy"   TEXT NOT NULL,
  "quote_ccy"  TEXT NOT NULL,
  "rate"       DECIMAL(15,6) NOT NULL,
  "source"     TEXT,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fx_rates_date_pair_key"
  ON "dc"."fx_rates" ("rate_date", "base_ccy", "quote_ccy");
CREATE INDEX IF NOT EXISTS "fx_rates_pair_date_idx"
  ON "dc"."fx_rates" ("base_ccy", "quote_ccy", "rate_date");
