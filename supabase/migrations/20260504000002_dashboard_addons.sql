-- Pooilgroup ERP — Dashboard add-ons
-- branch_targets, branch_health_scores, branch_streaks, missing_report_reasons
-- Run AFTER prisma migrate (or use prisma db push) so the table contracts match.
-- Adds RLS policies in the same migration so it stays internally consistent.

-- =============================================================
-- 1. branch_targets
-- =============================================================
CREATE TABLE IF NOT EXISTS public.branch_targets (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid           NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id   uuid           NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  year        integer        NOT NULL,
  month       integer        NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount      numeric(15,2)  NOT NULL,
  source      text           NOT NULL DEFAULT 'manual',
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_branch_targets_org_period
  ON public.branch_targets (org_id, year, month);

ALTER TABLE public.branch_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_targets_org_isolation ON public.branch_targets;
CREATE POLICY branch_targets_org_isolation ON public.branch_targets
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- =============================================================
-- 2. branch_health_scores
-- =============================================================
CREATE TABLE IF NOT EXISTS public.branch_health_scores (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id     uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  computed_for  date        NOT NULL,
  score         integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade         text        NOT NULL,
  breakdown     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, computed_for)
);
CREATE INDEX IF NOT EXISTS idx_branch_health_org_date
  ON public.branch_health_scores (org_id, computed_for DESC);
CREATE INDEX IF NOT EXISTS idx_branch_health_branch_date
  ON public.branch_health_scores (branch_id, computed_for DESC);

ALTER TABLE public.branch_health_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_health_org_isolation ON public.branch_health_scores;
CREATE POLICY branch_health_org_isolation ON public.branch_health_scores
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- =============================================================
-- 3. branch_streaks
-- =============================================================
CREATE TABLE IF NOT EXISTS public.branch_streaks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id         uuid        NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  current_streak    integer     NOT NULL DEFAULT 0,
  longest_streak    integer     NOT NULL DEFAULT 0,
  last_report_date  date,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branch_streaks_org
  ON public.branch_streaks (org_id);

ALTER TABLE public.branch_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_streaks_org_isolation ON public.branch_streaks;
CREATE POLICY branch_streaks_org_isolation ON public.branch_streaks
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- =============================================================
-- 4. missing_report_reasons
-- =============================================================
CREATE TABLE IF NOT EXISTS public.missing_report_reasons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id   uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  report_date date        NOT NULL,
  reason_type text        NOT NULL,
  reason_text text,
  reported_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_missing_report_org_date
  ON public.missing_report_reasons (org_id, report_date DESC);

ALTER TABLE public.missing_report_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS missing_report_org_isolation ON public.missing_report_reasons;
CREATE POLICY missing_report_org_isolation ON public.missing_report_reasons
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- =============================================================
-- Done.
-- =============================================================
