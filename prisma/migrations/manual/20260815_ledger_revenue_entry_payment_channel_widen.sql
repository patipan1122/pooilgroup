-- Widen ledger_revenue_entry.payment_channel: VARCHAR(30) → TEXT.
-- payment_channel is a free-text audit-trail label (channel_code is the normalized
-- enum used for matching/filtering — this column is display-only, same role as
-- `description` which is already TEXT).
--
-- 2026-08-15: CashHub Amazon's new combined settlement label "QRCredit + blueplus
-- Credit (API)" (32 chars, added same day in amazon-settlement.ts POS_EXTRACT_GROUPS)
-- exceeded the old 30-char cap and broke "ส่งเข้า reconcile" for store 4097 with
-- `value too long for type character varying(30)`.
-- lib/ledger/trcloud-revenue.ts also writes payment_channel straight from TRCloud's
-- raw payment_method field — an external, uncapped string — so a fixed VARCHAR(N)
-- will keep breaking as new channel names/wordings appear. TEXT has no storage/perf
-- cost over VARCHAR(N) in Postgres (ALTER ... TYPE TEXT from varchar is a fast,
-- metadata-only change — no table rewrite, no data loss).
ALTER TABLE public.ledger_revenue_entry
  ALTER COLUMN payment_channel TYPE TEXT;
