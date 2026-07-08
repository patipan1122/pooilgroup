-- ClawFleet bigfeature — baseline lock + machine photo + 4-meter snapshot + stock-count photos + repair kind.
-- Additive only. No Branch table changes (Branch shared with ChairOps/Playland).

-- N1/N4 · CfMachine: machine photo + once-only baseline lock
ALTER TABLE public.cf_machines
  ADD COLUMN IF NOT EXISTS photo_url                text,
  ADD COLUMN IF NOT EXISTS is_first_baseline_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_baseline_applied_at timestamptz;

-- N1 · CfCollectionSession: baseline round marker
ALTER TABLE public.cf_collection_sessions
  ADD COLUMN IF NOT EXISTS is_baseline boolean NOT NULL DEFAULT false;

-- N1 · CfCollectionEvent: 4 distinct physical meters (baseline snapshot + per round) + their photos
ALTER TABLE public.cf_collection_events
  ADD COLUMN IF NOT EXISTS meter_money_top    integer,
  ADD COLUMN IF NOT EXISTS meter_money_bottom integer,
  ADD COLUMN IF NOT EXISTS meter_doll_top     integer,
  ADD COLUMN IF NOT EXISTS meter_doll_bottom  integer,
  ADD COLUMN IF NOT EXISTS photo_money_meter_top_url    text,
  ADD COLUMN IF NOT EXISTS photo_money_meter_bottom_url text,
  ADD COLUMN IF NOT EXISTS photo_doll_meter_top_url     text,
  ADD COLUMN IF NOT EXISTS photo_doll_meter_bottom_url  text,
  ADD COLUMN IF NOT EXISTS photo_machine_url            text,
  ADD COLUMN IF NOT EXISTS short_reason text;  -- N5 SHORT reason (nullable; null on OK/OVER/round-1)

-- N3 · CfStockCount: attach photos + client idempotency key
ALTER TABLE public.cf_stock_counts
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS client_key text;   -- idempotency (nullable)

-- N1 · CfRepairTicket: distinguish FIRST_SETUP redo + who may approve
ALTER TABLE public.cf_repair_tickets
  ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'REPAIR',   -- REPAIR | FIRST_SETUP
  ADD COLUMN IF NOT EXISTS approver_role text;                            -- 'super_admin' for FIRST_SETUP redo

-- C2 · once-only baseline lock at DB level — partial-unique index
-- Only ONE baseline session per machine (guards 2 housekeepers/retry racing a second baseline).
-- Uses group_id? no — baseline is machine-scoped. Enforce on the baseline EVENT (INITIAL) per machine,
-- because a session can span a group. Partial-unique on the INITIAL event:
CREATE UNIQUE INDEX IF NOT EXISTS cf_events_one_baseline_per_machine
  ON public.cf_collection_events (machine_id)
  WHERE event_type = 'INITIAL';

-- N3 idempotency: one stock-count per client_key per org (nullable keys not enforced)
CREATE UNIQUE INDEX IF NOT EXISTS cf_stock_counts_org_clientkey_uq
  ON public.cf_stock_counts (org_id, client_key)
  WHERE client_key IS NOT NULL;

-- N2 checklist perf: branch×day scan
CREATE INDEX IF NOT EXISTS cf_events_branch_day_idx
  ON public.cf_collection_events (org_id, machine_id, collected_at);
