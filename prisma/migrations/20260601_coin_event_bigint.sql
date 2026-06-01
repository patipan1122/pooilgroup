-- 2026-06-01 · ChairOps · coin event counters Int → BigInt
--
-- StarThing's coin meter is an UNSIGNED 32-bit counter. At least one chair
-- already crossed int4 max (saw value 4_293_916_823 ≈ uint32 max). PostgreSQL
-- INT (int4) signed max is 2_147_483_647, so the column overflowed and
-- prisma.chairopsPosCoinEvent.createMany() threw:
--   "Value out of range for the type: value \"4293916823\" is out of range
--    for type integer"
--
-- Bump to BIGINT (int8) — Postgres supports it natively · holds up to
-- 9.2e18, leaving 9 orders of magnitude of headroom. cashAdded / cashMeter
-- are already Decimal(12,2) so no change needed there.
--
-- Safe to run on a live table: ALTER TYPE INT → BIGINT is a metadata-only
-- change in Postgres ≥10 (no rewrite, no lock escalation beyond a brief
-- ACCESS EXCLUSIVE during the catalog update). Existing rows fit trivially.

-- IMPORTANT · table name is snake_case via Prisma @@map. The Prisma model
-- is ChairopsPosCoinEvent but the actual Postgres relation is
-- chairops.chairops_pos_coin_event. Columns however keep camelCase ("coinAdded"
-- / "coinMeter") because Prisma does not lowercase column names by default.
ALTER TABLE chairops.chairops_pos_coin_event
  ALTER COLUMN "coinAdded" TYPE BIGINT USING "coinAdded"::bigint,
  ALTER COLUMN "coinMeter" TYPE BIGINT USING "coinMeter"::bigint;

-- Sanity check (run separately, expect bigint twice):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'chairops'
--   AND table_name = 'chairops_pos_coin_event'
--   AND column_name IN ('coinAdded', 'coinMeter');
