-- =============================================================
-- ChairOps · Google Drive backup (CEO 2026-06-03)
-- =============================================================
-- CEO wants slip/receipt/contract images archived in HIS Google Drive
-- (free 2 TB) — the app uploads, keeps the file link, and (later) drops the
-- R2 copy after ~2 months to save storage cost.
--
-- This migration creates:
--   (a) ChairopsDriveConnection — 1 row per org · stores the OAuth refresh
--       token (AES-GCM encrypted) + the root backup folder id + the connected
--       Google account email. One connection per org (@@unique orgId).
--   (b) ChairopsDriveAsset — registry of every file we dual-stored (R2 + Drive)
--       so the offload cron knows exactly which R2 objects are safe to delete
--       (verified Drive copy exists) — it never touches arbitrary R2 keys.
--
-- RLS: deny-all default · server actions use the service role (bypasses RLS).
-- Pattern mirrors chairops_vendor_bill / maid_roster migrations.
--
-- DO NOT APPLY directly · classifier blocks prod DB writes ·
-- CEO runs `supabase db push` manually after this PR ships.
-- =============================================================

BEGIN;

SET search_path = chairops, public;

-- -------------------------------------------------------------
-- (a) ChairopsDriveConnection · one Google Drive link per org
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."ChairopsDriveConnection" (
  "id"              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"           TEXT         NOT NULL,
  "refreshTokenEnc" TEXT         NOT NULL,      -- AES-256-GCM "iv:cipher:tag"
  "rootFolderId"    TEXT,                       -- Drive id of "เก้าอี้นวด backup1"
  "rootFolderName"  TEXT         NOT NULL DEFAULT 'เก้าอี้นวด backup1',
  "driveEmail"      TEXT,                       -- which Google account
  "scopes"          TEXT,
  "connectedById"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsDriveConnection_orgId_key"
  ON chairops."ChairopsDriveConnection" ("orgId");

-- -------------------------------------------------------------
-- (b) ChairopsDriveAsset · registry of dual-stored files
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chairops."ChairopsDriveAsset" (
  "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"          TEXT         NOT NULL,
  -- 'contract' | 'expense_slip' | 'income_slip' | 'other'
  "category"       TEXT         NOT NULL,
  "periodYm"       TEXT         NOT NULL,        -- "YYYY-MM" folder bucket
  "r2Key"          TEXT,                         -- null once offloaded
  "r2Url"          TEXT,
  "driveFileId"    TEXT         NOT NULL,
  "driveUrl"       TEXT         NOT NULL,        -- webViewLink (opens in Drive)
  "driveDirectUrl" TEXT,                         -- uc?export=view inline link
  "fileName"       TEXT,
  "sizeBytes"      INTEGER,
  -- soft pointer back to the owning row (audit only · no FK · cross-table)
  "sourceTable"    TEXT,
  "sourceId"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "offloadedAt"    TIMESTAMP(3)                  -- set when R2 copy deleted
);

CREATE INDEX IF NOT EXISTS "ChairopsDriveAsset_orgId_idx"
  ON chairops."ChairopsDriveAsset" ("orgId");
-- offload cron scans: not-yet-offloaded, oldest first
CREATE INDEX IF NOT EXISTS "ChairopsDriveAsset_offload_scan_idx"
  ON chairops."ChairopsDriveAsset" ("orgId", "offloadedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ChairopsDriveAsset_source_idx"
  ON chairops."ChairopsDriveAsset" ("sourceTable", "sourceId");

-- -------------------------------------------------------------
-- (c) Row-Level Security · deny-all default (service role bypasses)
-- -------------------------------------------------------------
ALTER TABLE chairops."ChairopsDriveConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE chairops."ChairopsDriveAsset"      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'chairops' AND tablename = 'ChairopsDriveConnection'
      AND policyname = 'drive_conn_deny_all_default'
  ) THEN
    CREATE POLICY "drive_conn_deny_all_default"
      ON chairops."ChairopsDriveConnection"
      FOR ALL TO PUBLIC
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'chairops' AND tablename = 'ChairopsDriveAsset'
      AND policyname = 'drive_asset_deny_all_default'
  ) THEN
    CREATE POLICY "drive_asset_deny_all_default"
      ON chairops."ChairopsDriveAsset"
      FOR ALL TO PUBLIC
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
END $$;

COMMIT;
