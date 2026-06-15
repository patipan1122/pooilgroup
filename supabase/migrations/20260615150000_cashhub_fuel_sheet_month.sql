-- CashHub ⛽ ปั๊ม 62 — FULL sheet mirror (every column, every month) for the
-- "ตารางเต็มเหมือนชีต" view. ADDITIVE ONLY: separate table, does not touch
-- cashhub_fuel_daily (the reconcile view) or daily_reports.
--
-- One row PER MONTH. The grid is stored verbatim (header-driven, all ~43 columns)
-- so the UI reproduces the Google Sheet 1:1 across the 4 column layouts the sheet
-- drifted through over 2 years. headers/rows are opaque JSONB the client renders.

CREATE TABLE IF NOT EXISTS public.cashhub_fuel_sheet_month (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  pump_key          text NOT NULL DEFAULT 'pump62',

  year              int  NOT NULL,           -- Gregorian (CE)
  month             int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  period_key        text NOT NULL,           -- 'YYYY-MM' (selector value)
  label             text NOT NULL,           -- 'พ.ค. 2569'
  sheet_tab         text NOT NULL,           -- provenance

  -- [{ c:int, group:string, name:string }] — column definitions, in sheet order.
  headers           jsonb NOT NULL DEFAULT '[]',
  -- [{ date:'YYYY-MM-DD', day:int, shift:string, cells:(number|string|null)[] }]
  rows              jsonb NOT NULL DEFAULT '[]',
  ncol              int  NOT NULL DEFAULT 0,

  -- completeness (verified at import — every day present?)
  days_present      int  NOT NULL DEFAULT 0,
  expected_days     int  NOT NULL DEFAULT 0,
  missing_days      jsonb NOT NULL DEFAULT '[]',

  source            text NOT NULL DEFAULT 'ym62_sheet',
  source_fetched_at timestamptz NULL,
  imported_by_id    uuid NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Idempotent re-import: one row per org/pump/month.
CREATE UNIQUE INDEX IF NOT EXISTS cashhub_fuel_sheet_month_uniq
  ON public.cashhub_fuel_sheet_month (org_id, pump_key, year, month);

CREATE INDEX IF NOT EXISTS cashhub_fuel_sheet_month_period_idx
  ON public.cashhub_fuel_sheet_month (org_id, pump_key, period_key);

ALTER TABLE public.cashhub_fuel_sheet_month ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cashhub_fuel_sheet_month_org_isolation ON public.cashhub_fuel_sheet_month;
CREATE POLICY cashhub_fuel_sheet_month_org_isolation ON public.cashhub_fuel_sheet_month
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
