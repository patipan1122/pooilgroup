-- ============================================================
-- CostCtrl · ศูนย์ควบคุมต้นทุน (Pool ERP Module #10)
-- BIGFEATURE 2026-05-31 · super_admin only · CEO-facing cost dashboard
-- Spec: docs/BIGFEATURE_costctrl_SPEC.md
-- 5 tables + extend ai_usage with provider/model + seed 5 providers
-- ============================================================

-- ── 1. cost_provider ────────────────────────────────────────
-- One row per cost source we track (vercel, supabase, r2, anthropic, gemini)
-- budget_monthly: JSON map "YYYY-MM" → USD (denormalized, monthly history small)
CREATE TABLE IF NOT EXISTS public.cost_provider (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  category          TEXT NOT NULL,                  -- hosting | database | storage | ai
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  pricing_note      TEXT,
  budget_monthly    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cost_provider_enabled_idx
  ON public.cost_provider(enabled) WHERE enabled = TRUE;

-- ── 2. cost_snapshot ───────────────────────────────────────
-- Daily metric capture · period_month is 1st-of-month so MTD aggregation is fast
CREATE TABLE IF NOT EXISTS public.cost_snapshot (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES public.cost_provider(id) ON DELETE CASCADE,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_month  DATE NOT NULL,                        -- 1st of month
  metric        TEXT NOT NULL,                        -- bandwidth_gb | tokens_in | storage_mb | cost_usd | ...
  unit          TEXT NOT NULL,                        -- GB | tokens | count | USD
  value         NUMERIC(20, 6) NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  raw           JSONB,
  source        TEXT NOT NULL                         -- api | manual | aggregated
);

CREATE INDEX IF NOT EXISTS cost_snapshot_provider_month_metric_idx
  ON public.cost_snapshot(provider_id, period_month DESC, metric);
CREATE INDEX IF NOT EXISTS cost_snapshot_captured_idx
  ON public.cost_snapshot(captured_at DESC);

-- ── 3. cost_alert_rule ─────────────────────────────────────
-- Threshold rules · evaluated each cron cycle · respects cooldown_hours
CREATE TABLE IF NOT EXISTS public.cost_alert_rule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES public.cost_provider(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL,
  threshold_pct   NUMERIC(5, 2),                      -- e.g. 80 = 80% of monthly budget
  threshold_abs   NUMERIC(20, 6),                     -- absolute value (alternative)
  channel         TEXT NOT NULL DEFAULT 'line',       -- line | email
  cooldown_hours  INT NOT NULL DEFAULT 24,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_alert_rule_threshold_chk
    CHECK (threshold_pct IS NOT NULL OR threshold_abs IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS cost_alert_rule_provider_idx
  ON public.cost_alert_rule(provider_id) WHERE enabled = TRUE;

-- ── 4. cost_alert_event ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_alert_event (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID NOT NULL REFERENCES public.cost_alert_rule(id) ON DELETE CASCADE,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_value  NUMERIC(20, 6) NOT NULL,
  threshold_value NUMERIC(20, 6) NOT NULL,
  message         TEXT NOT NULL,
  notified_at     TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cost_alert_event_triggered_idx
  ON public.cost_alert_event(triggered_at DESC);

-- ── 5. cost_api_credential ─────────────────────────────────
-- Encrypted provider API tokens (AES-256-GCM via COSTCTRL_CRYPTO_KEY env)
-- super_admin-only access via RLS · plaintext NEVER stored
CREATE TABLE IF NOT EXISTS public.cost_api_credential (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES public.cost_provider(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  scope         TEXT,
  ciphertext    TEXT NOT NULL,
  enc_version   INT NOT NULL DEFAULT 1,
  last_used_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (provider_id, label)
);

-- ── 6. Extend ai_usage with provider/model for proper attribution ──
-- Both nullable + default NULL → backwards-compatible · existing rows keep working
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS provider TEXT,             -- anthropic | gemini | openai | ...
  ADD COLUMN IF NOT EXISTS model    TEXT,             -- claude-sonnet-4-6 | gemini-2.5-flash | ...
  ADD COLUMN IF NOT EXISTS module   TEXT;             -- cashhub | docuflow | recruit | inbox | ...

CREATE INDEX IF NOT EXISTS ai_usage_provider_month_idx
  ON public.ai_usage(provider, created_at DESC) WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_module_month_idx
  ON public.ai_usage(module, created_at DESC) WHERE module IS NOT NULL;

-- ── 7. RLS — super_admin only ─────────────────────────────
-- Every cost_* table: only super_admin sees · admin/org_admin do NOT
ALTER TABLE public.cost_provider        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_snapshot        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_alert_rule      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_alert_event     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_api_credential  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_provider_super_admin ON public.cost_provider;
CREATE POLICY cost_provider_super_admin ON public.cost_provider
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ));

DROP POLICY IF EXISTS cost_snapshot_super_admin ON public.cost_snapshot;
CREATE POLICY cost_snapshot_super_admin ON public.cost_snapshot
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ));

DROP POLICY IF EXISTS cost_alert_rule_super_admin ON public.cost_alert_rule;
CREATE POLICY cost_alert_rule_super_admin ON public.cost_alert_rule
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ));

DROP POLICY IF EXISTS cost_alert_event_super_admin ON public.cost_alert_event;
CREATE POLICY cost_alert_event_super_admin ON public.cost_alert_event
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ));

DROP POLICY IF EXISTS cost_api_credential_super_admin ON public.cost_api_credential;
CREATE POLICY cost_api_credential_super_admin ON public.cost_api_credential
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'super_admin'
  ));

-- ── 8. Seed 5 providers (idempotent) ───────────────────────
INSERT INTO public.cost_provider (slug, display_name, category, pricing_note, budget_monthly)
VALUES
  ('vercel',    'Vercel',          'hosting',  'Hobby $0 · Pro $20/seat · BW $0.15/GB after 1TB · function GB-hr $40/M · build-min $0.04/min', '{"default": 20}'::jsonb),
  ('supabase',  'Supabase',        'database', 'Free 500MB DB · Pro $25 + 8GB DB · egress $0.09/GB after 50GB · MAU $0.00325 after 100k',     '{"default": 25}'::jsonb),
  ('r2',        'Cloudflare R2',   'storage',  'Free 10GB · $0.015/GB-mo storage · Class A $4.50/M · Class B $0.36/M · egress FREE',           '{"default": 5}'::jsonb),
  ('anthropic', 'Anthropic Claude','ai',       'Sonnet 4.6 $3/M-in $15/M-out · Haiku 4.5 $1/M-in $5/M-out · Opus 4.7 $15/M-in $75/M-out',     '{"default": 50}'::jsonb),
  ('gemini',    'Google Gemini',   'ai',       'Flash 2.5 $0.075/M-in $0.30/M-out (free 1.5k req/day) · Pro $1.25/M-in $5/M-out',              '{"default": 10}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  pricing_note = EXCLUDED.pricing_note;

-- Seed default alert rules: 80% of monthly budget warning + 100% hard
-- alerts on cost_usd metric only · others can be added via UI
INSERT INTO public.cost_alert_rule (provider_id, metric, threshold_pct, channel, cooldown_hours)
SELECT id, 'cost_usd', 80, 'line', 24 FROM public.cost_provider WHERE slug IN ('vercel','supabase','r2','anthropic','gemini')
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_alert_rule (provider_id, metric, threshold_pct, channel, cooldown_hours)
SELECT id, 'cost_usd', 100, 'line', 12 FROM public.cost_provider WHERE slug IN ('vercel','supabase','r2','anthropic','gemini')
ON CONFLICT DO NOTHING;
