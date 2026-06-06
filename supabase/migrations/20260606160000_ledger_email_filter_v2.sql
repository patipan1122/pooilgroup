-- LedgerLine email-scan filter v2: Gmail label + subject keyword filter per mailbox.
-- Additive only — existing rows get gmail_label=NULL, filter_keywords='{}' which the
-- query builder already treats as "omit clause" → no behavior change for existing mailboxes.
-- Deploy: psql DIRECT_URL before pushing code (concurrent-session-migration-trap).

ALTER TABLE public.ledger_email_connection
  ADD COLUMN IF NOT EXISTS gmail_label      text,
  ADD COLUMN IF NOT EXISTS filter_keywords  text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ledger_email_connection.gmail_label IS
  'Gmail label name filter — scanner adds label:"name" to query when set. CEO must pre-create this label in Gmail. NULL = no label filter.';

COMMENT ON COLUMN public.ledger_email_connection.filter_keywords IS
  'Subject keyword allow-list — scanner adds subject:(k1 OR k2) when non-empty. Empty = no subject filter.';
