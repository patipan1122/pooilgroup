-- LedgerLine · email-scan: per-message dedup / audit / suppress-list driver / run-summary.
-- One row per scanned Gmail message. The (connection_id, gmail_message_id) unique
-- index is the cost gate: a re-scan never re-calls AI on a message already seen.
-- Decisions: docs/WORKSHOP_ledger-email-scan.md. ADDITIVE ONLY. Apply via psql DIRECT_URL.

create table if not exists public.ledger_email_message (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  company_id       uuid not null,
  connection_id    uuid not null,
  gmail_message_id text not null,
  status           text not null default 'imported', -- imported | needs_manual | skipped | error
  sender_email     text,
  subject          text,
  received_at      timestamptz,
  scan_run_id      text,
  expense_id       uuid,
  note             text,
  created_at       timestamptz not null default now()
);

-- dedup gate: a message is processed once per connection (re-scan = skip, no AI)
create unique index if not exists ledger_email_message_conn_msg_key
  on public.ledger_email_message (connection_id, gmail_message_id);

create index if not exists ledger_email_message_org_company_idx
  on public.ledger_email_message (org_id, company_id);

-- server-side only (Prisma admin client); no client read path
alter table public.ledger_email_message enable row level security;
