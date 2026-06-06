-- LedgerLine · email-scan foundation: per-mailbox Gmail connection.
-- Decisions: docs/WORKSHOP_ledger-email-scan.md (D1 = NEW LedgerLine-owned table,
-- MULTIPLE mailboxes per company — ChairopsGmailConnection is org-only, can't
-- carry company routing or several mailboxes; W-024). Reuses the SAME Google
-- OAuth app + AES-256-GCM crypto as ChairOps Drive/Gmail.
-- ADDITIVE ONLY. Apply via psql DIRECT_URL (per concurrent-session migration rule).

create table if not exists public.ledger_email_connection (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  company_id         uuid not null,
  gmail_email        text not null,
  refresh_token_enc  text not null,
  scopes             text,
  connected_by_id    uuid,
  filter_senders     text[] not null default '{}',
  suppressed_senders text[] not null default '{}',
  last_sync_at       timestamptz,
  last_sync_status   text,
  last_sync_count    integer not null default 0,
  first_scan_done    boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- one row per (org, company, mailbox) → multi-mailbox per legal entity
create unique index if not exists ledger_email_connection_org_company_email_key
  on public.ledger_email_connection (org_id, company_id, gmail_email);

create index if not exists ledger_email_connection_org_company_active_idx
  on public.ledger_email_connection (org_id, company_id, active);

-- RLS on, no policies: server-side only (Prisma admin client bypasses).
-- The refresh token never leaves the server; no anon/authenticated read path.
alter table public.ledger_email_connection enable row level security;
