-- ChairOps: damage-ticket + cleanliness-report idempotency (ultramobileux audit
-- P0-6, 2026-10-07). Neither table had ANY dedup mechanism — a double-tap or a
-- network retry after a slow submit created a second ticket/report with no way
-- to tell it was a duplicate. Same pattern as cf_stock_counts/cf_collection_events:
-- ADDITIVE · nullable client_key · partial unique index (NULLS not enforced) so
-- existing rows are untouched and legacy/office paths without a key keep working.
ALTER TABLE chairops."ChairopsDamageTicket"
  ADD COLUMN IF NOT EXISTS "client_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsDamageTicket_org_id_client_key_key"
  ON chairops."ChairopsDamageTicket" ("orgId", "client_key")
  WHERE "client_key" IS NOT NULL;

ALTER TABLE chairops."ChairopsCleanlinessReport"
  ADD COLUMN IF NOT EXISTS "client_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsCleanlinessReport_org_id_client_key_key"
  ON chairops."ChairopsCleanlinessReport" ("orgId", "client_key")
  WHERE "client_key" IS NOT NULL;
