-- Migration 004: rate_limit_attempts + cron_runs (idempotency log)
-- Used by lib/rate-limit/* and lib/cron/* helpers
-- Idempotent — safe to re-run

-- ============================================================
-- rate_limit_attempts — buckets ของ IP/user สำหรับ login + register
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,           -- เช่น "auth:ip:1.2.3.4" / "register:ip:5.6.7.8"
  metadata JSONB DEFAULT '{}',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rl_bucket_time_idx
  ON public.rate_limit_attempts(bucket, attempted_at DESC);

-- Auto-cleanup: rows older than 24h not needed (longest window we use is 1h)
-- Run via cron (access-review uses it)
-- DELETE FROM public.rate_limit_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours';

-- RLS — service role only (no public read/write)
ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rl_no_access ON public.rate_limit_attempts;
CREATE POLICY rl_no_access ON public.rate_limit_attempts
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ============================================================
-- cron_runs — idempotency log สำหรับ cron jobs (BUG-019)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,        -- เช่น "morning-brief", "evening-check"
  run_date DATE NOT NULL,         -- วันที่รัน (Asia/Bangkok)
  status TEXT NOT NULL,           -- "success" | "failed" | "skipped_duplicate"
  duration_ms INT,
  payload JSONB DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (cron_name, run_date)
);

CREATE INDEX IF NOT EXISTS cron_runs_name_date_idx
  ON public.cron_runs(cron_name, run_date DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cron_runs_admin_read ON public.cron_runs;
CREATE POLICY cron_runs_admin_read ON public.cron_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'org_admin', 'admin')
    )
  );

-- ============================================================
-- ai_usage — token cost tracking สำหรับ AI endpoints (BUG-017)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,         -- "cashhub.ai" | "docuflow.ai-search"
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_user_time_idx
  ON public.ai_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_org_month_idx
  ON public.ai_usage(org_id, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_self_read ON public.ai_usage;
CREATE POLICY ai_usage_self_read ON public.ai_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.org_id = ai_usage.org_id
    AND u.role IN ('super_admin', 'org_admin', 'admin')
  ));
