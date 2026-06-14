-- Pinpoint / โหมดติชม — in-app multi-pin visual annotation
--
-- Workshop spec: docs/WORKSHOP_pinpoint.md (2026-06-14, war-room 2 rounds)
-- A session collects many pins across many pages; on "finish" one consolidated
-- row is written into bug_reports so /bugs surfaces it natively. Pins carry the
-- structured target (url + element selector + innerText + coords%) which is the
-- load-bearing payload for the developer/Claude; the screenshot is best-effort.
--
-- Runtime queries go through the Supabase JS client (RLS-enforced) — same as
-- bug_reports. NOT mapped into prisma/schema.prisma to avoid editing the shared
-- Organization/User core models (collision-safe with parallel sessions).
--
-- Self-contained (CREATE TYPE + TABLE + RLS) — paste into the Supabase SQL editor.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE "PinpointSessionStatus" AS ENUM ('draft','submitted','reviewed','exported','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PinpointPriority" AS ENUM ('urgent','normal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PinpointPinStatus" AS ENUM ('open','fixed','wontfix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Sessions — one walk-through, many pins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pinpoint_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title                  text,
  status                 "PinpointSessionStatus" NOT NULL DEFAULT 'draft',
  reviewed_by_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at            timestamptz(6),
  exported_at            timestamptz(6),
  -- back-link to the single bug_reports row created on finish (so /bugs shows it)
  consolidated_report_id uuid REFERENCES public.bug_reports(id) ON DELETE SET NULL,
  pin_count              int  NOT NULL DEFAULT 0,
  created_at             timestamptz(6) NOT NULL DEFAULT now(),
  finished_at            timestamptz(6),
  updated_at             timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pinpoint_sessions_org_status_created_idx
  ON public.pinpoint_sessions (org_id, status, created_at);
CREATE INDEX IF NOT EXISTS pinpoint_sessions_author_created_idx
  ON public.pinpoint_sessions (author_id, created_at);

-- ============================================================
-- 3. Pins — one structured-target comment each
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pinpoint_pins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES public.pinpoint_sessions(id) ON DELETE CASCADE,
  -- denormalized for fast RLS + per-org sweeps (avoids a join to sessions)
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seq              int  NOT NULL DEFAULT 0,
  url              text NOT NULL,                 -- pathname + search at pin time
  element_selector text,                          -- robust CSS path (best guess)
  element_text     text,                          -- innerText snippet fallback (<=120ch)
  element_meta     jsonb,                          -- { tag, id, testid, role, ariaLabel, classes, rect }
  coord_x_pct      double precision,              -- pin position as % of viewport
  coord_y_pct      double precision,
  viewport_w       int,
  viewport_h       int,
  comment          text,
  priority         "PinpointPriority"  NOT NULL DEFAULT 'normal',
  status           "PinpointPinStatus" NOT NULL DEFAULT 'open',
  screenshot_key   text,                          -- R2 key (null = capture skipped/failed)
  fixed_at         timestamptz(6),
  fixed_commit_sha text,
  created_at       timestamptz(6) NOT NULL DEFAULT now(),
  updated_at       timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pinpoint_pins_session_seq_idx
  ON public.pinpoint_pins (session_id, seq);
CREATE INDEX IF NOT EXISTS pinpoint_pins_org_created_idx
  ON public.pinpoint_pins (org_id, created_at);

-- ============================================================
-- 4. RLS + org_isolation (mirrors bug_reports exactly)
-- ============================================================
ALTER TABLE public.pinpoint_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pinpoint_sessions_org_isolation" ON public.pinpoint_sessions;
CREATE POLICY "pinpoint_sessions_org_isolation"
  ON public.pinpoint_sessions
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

ALTER TABLE public.pinpoint_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pinpoint_pins_org_isolation" ON public.pinpoint_pins;
CREATE POLICY "pinpoint_pins_org_isolation"
  ON public.pinpoint_pins
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 5. Verify (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename IN ('pinpoint_sessions','pinpoint_pins');
--   SELECT policyname FROM pg_policies
--   WHERE schemaname='public' AND tablename LIKE 'pinpoint_%';
