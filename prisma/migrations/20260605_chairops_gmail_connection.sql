-- ChairOps Gmail connection table (auto-import StarThing XLSX from Gmail).
-- Pattern mirrors chairops_drive_connection (CEO 2026-06-05).

CREATE TABLE IF NOT EXISTS chairops."chairops_gmail_connection" (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  org_id           TEXT        NOT NULL,
  gmail_email      TEXT,
  refresh_token_enc TEXT       NOT NULL,    -- AES-256-GCM "iv:cipher:tag"
  scopes           TEXT,
  connected_by_id  TEXT,
  last_sync_at     TIMESTAMPTZ,
  last_sync_status TEXT,                    -- 'ok' | 'error: <msg>'
  last_sync_count  INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chairops_gmail_connection_pkey PRIMARY KEY (id),
  CONSTRAINT chairops_gmail_connection_org_id_key UNIQUE (org_id)
);
