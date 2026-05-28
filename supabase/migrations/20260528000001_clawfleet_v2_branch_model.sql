-- ClawFleet v2 — branch-based model migration (รอบ 61 · 2026-05-28)
-- CEO decision: "Migrate ใหญ่ให้ตรง mockup 100%"
-- ADDITIVE ONLY · no DROP · safe for shared Supabase (cf_* prefix isolates).
-- See docs/CLAWFLEET_V2_PHASE2_PLAN.md

BEGIN;

-- 1. cf_collection_sessions: branch-level support + branch cross-check snapshot
ALTER TABLE public.cf_collection_sessions
  ALTER COLUMN group_id DROP NOT NULL;

ALTER TABLE public.cf_collection_sessions
  ADD COLUMN IF NOT EXISTS branch_id            uuid,
  ADD COLUMN IF NOT EXISTS expected_cash_cents  integer,
  ADD COLUMN IF NOT EXISTS actual_cash_cents    integer,
  ADD COLUMN IF NOT EXISTS cash_variance_bps    integer,
  ADD COLUMN IF NOT EXISTS prize_meter_out      integer,
  ADD COLUMN IF NOT EXISTS prize_counted_out    integer,
  ADD COLUMN IF NOT EXISTS prize_variance       integer;

-- FK branch_id → branches (RESTRICT) · guard against re-run
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cf_collection_sessions_branch_id_fkey'
  ) THEN
    ALTER TABLE public.cf_collection_sessions
      ADD CONSTRAINT cf_collection_sessions_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- backfill branch_id from each session's group's branch (legacy group sessions)
UPDATE public.cf_collection_sessions s
SET branch_id = g.branch_id
FROM public.cf_machine_groups g
WHERE s.group_id = g.id AND s.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS cf_collection_sessions_org_branch_opened_idx
  ON public.cf_collection_sessions (org_id, branch_id, opened_at DESC);

-- 2. cf_collection_events: 5th photo (prize-sensor meter)
ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS photo_prize_meter_url text;

-- 3. cf_deliveries (central-warehouse shipments)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CfDeliveryStatus') THEN
    CREATE TYPE public."CfDeliveryStatus" AS ENUM ('SCHEDULED','IN_TRANSIT','DELIVERED','CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cf_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  status        public."CfDeliveryStatus" NOT NULL DEFAULT 'SCHEDULED',
  from_location text NOT NULL DEFAULT 'คลังกลาง บางนา',
  eta           timestamptz,
  items_count   integer NOT NULL DEFAULT 0,
  units_count   integer NOT NULL DEFAULT 0,
  note          text,
  created_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_deliveries_org_branch_eta_idx
  ON public.cf_deliveries (org_id, branch_id, eta DESC);
CREATE INDEX IF NOT EXISTS cf_deliveries_org_status_idx
  ON public.cf_deliveries (org_id, status);

-- RLS (match other cf_ tables — org-scoped via existing pattern)
ALTER TABLE public.cf_deliveries ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cf_deliveries' AND policyname='cf_deliveries_service_role'
  ) THEN
    CREATE POLICY cf_deliveries_service_role ON public.cf_deliveries
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
