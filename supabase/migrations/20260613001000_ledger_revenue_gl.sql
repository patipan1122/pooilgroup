-- LedgerLine — Revenue Import + Channel→GL (Wave 1 foundation)
-- Adds channel-coding + chart-of-accounts (GL) linkage to the revenue book side,
-- so income can be brought in TAGGED BY CHANNEL (cash/transfer/card/qr) and each
-- channel LINKED to a GL account for reconciliation against the bank statement.
--
-- Feature-flagged in code behind LEDGER_REVENUE_GL_V1. ADDITIVE + idempotent:
-- every new column is NULLABLE (no default-backfill that rewrites existing rows),
-- the config table is brand-new → with the flag OFF runtime is byte-equivalent.
--
-- Design (5-persona panel, docs/BIGFEATURE_revenue-import_SPEC.md):
--   • channel_code = normalized enum (raw payment_channel stays untouched as audit trail)
--   • gl_account   = SNAPSHOT at entry-time (immutable; a later config edit must NOT
--                    re-code historical revenue — QA gate AG-3)
--   • debit-side clearing (1010/1110/1150) + MDR fee → ledger_revenue_channel_gl
--   • credit-side revenue (4xxx) → TRCloud is book of record; income category optional tag

-- ============================================================
-- 1. ledger_revenue_entry — channel + GL columns (all nullable, additive)
-- ============================================================
ALTER TABLE public.ledger_revenue_entry
  ADD COLUMN IF NOT EXISTS channel_code varchar(20),   -- cash|transfer|card|qr|wallet|cod|other (normalized)
  ADD COLUMN IF NOT EXISTS category_id  uuid,          -- optional → ledger_category(kind='income') GL tag
  ADD COLUMN IF NOT EXISTS gl_account   varchar(20),   -- SNAPSHOT GL code (immutable after assign)
  ADD COLUMN IF NOT EXISTS gl_state     varchar(20);   -- NULL=untouched | unconfigured | resolved | posted

-- Soft channel constraint (allow NULL for legacy/un-tagged rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_revenue_entry_channel_code_chk'
  ) THEN
    ALTER TABLE public.ledger_revenue_entry
      ADD CONSTRAINT ledger_revenue_entry_channel_code_chk
      CHECK (channel_code IS NULL OR channel_code IN
        ('cash','transfer','card','qr','wallet','cod','other'));
  END IF;
END $$;

-- Pivot index: management view groups by company × period × channel.
CREATE INDEX IF NOT EXISTS ledger_revenue_entry_channel_idx
  ON public.ledger_revenue_entry (company_id, entry_date, channel_code);

-- ============================================================
-- 2. ledger_revenue_channel_gl — per-business channel → GL default mapping
--    (mirrors ledger_bank_account_company shape: org+company scoped, RLS org-policy)
--    "ธุรกิจไหน · ช่องทางไหน → ลงผังบัญชีไหน" — set once, super_admin edits.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ledger_revenue_channel_gl (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  company_id    uuid NOT NULL,
  channel_code  varchar(20) NOT NULL
    CHECK (channel_code IN ('cash','transfer','card','qr','wallet','cod','other')),
  -- debit-side clearing (where the money lands): 1010 cash-on-hand / 1110 bank / 1150 card-clearing
  gl_clearing   varchar(20),
  -- credit-side revenue (optional tag — TRCloud owns the real 4xxx posting)
  gl_income     varchar(20),
  category_id   uuid,                 -- optional → ledger_category(kind='income')
  -- card/QR fee (MDR) expense GL; falls back to ledger_bank_account.mdr_gl_account
  gl_fee        varchar(20),
  label         varchar(100),         -- human label e.g. "เงินสดหน้าร้าน"
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, company_id, channel_code)
);

CREATE INDEX IF NOT EXISTS ledger_revenue_channel_gl_co_idx
  ON public.ledger_revenue_channel_gl (org_id, company_id);

ALTER TABLE public.ledger_revenue_channel_gl ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ledger_revenue_channel_gl'
      AND policyname = 'ledger_revenue_channel_gl_org_policy'
  ) THEN
    CREATE POLICY ledger_revenue_channel_gl_org_policy
      ON public.ledger_revenue_channel_gl FOR ALL
      TO authenticated
      USING (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid))
      WITH CHECK (org_id = (SELECT ((auth.jwt() -> 'app_metadata' ->> 'org_id'))::uuid));
  END IF;
END $$;

-- ============================================================
-- 3. Conservative backfill of channel_code from existing payment_channel.
--    Only fills the brand-new NULL column from known values — does NOT touch
--    any existing column, so the OFF-path stays byte-equivalent (AG-1).
--    Anything unrecognized stays NULL (the code normalizer re-runs on next write).
-- ============================================================
UPDATE public.ledger_revenue_entry
SET channel_code = CASE
  WHEN payment_channel IS NULL OR btrim(payment_channel) = '' THEN NULL
  WHEN lower(payment_channel) ~ '(cash|เงินสด|สด)'                         THEN 'cash'
  WHEN lower(payment_channel) ~ '(qr|พร้อมเพย์|พร้อมเพ|promptpay|prompt pay)' THEN 'qr'
  WHEN lower(payment_channel) ~ '(card|บัตร|credit|debit|visa|master|edc)'  THEN 'card'
  WHEN lower(payment_channel) ~ '(transfer|โอน|bank|ธนาคาร)'                THEN 'transfer'
  WHEN lower(payment_channel) ~ '(wallet|truemoney|true money|วอลเล)'       THEN 'wallet'
  WHEN lower(payment_channel) ~ '(cod|ปลายทาง|เก็บเงินปลายทาง)'             THEN 'cod'
  ELSE NULL
END
WHERE channel_code IS NULL;
