-- CashHub ⛽ ปั๊มน้ำมัน (ปั๊ม 62 หัวทะเล · วายเอ็มพลัส) — daily sales + cash/bank reconciliation.
-- ADDITIVE ONLY. No change to daily_reports. With CASHHUB_FUEL_V1 OFF the runtime is byte-equivalent.
-- Dedicated typed table = source of truth for the management page (mirrors cashhub_amazon/tea/hotel_daily).

CREATE TABLE IF NOT EXISTS public.cashhub_fuel_daily (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,

  -- Pump identity. branch_id is NULLABLE so v1 ships BEFORE the CEO decides whether
  -- ปั๊ม62/YM+ is an existing POOIL branch or a new entity. pump_key is the STABLE
  -- surrogate the unique key uses (a NULL in a unique index would let re-imports dupe).
  pump_key          text NOT NULL DEFAULT 'pump62',
  branch_id         uuid NULL,

  report_date       date NOT NULL,
  shift             text NOT NULL CHECK (shift IN ('morning','evening')),  -- เช้า / ค่ำ
  sheet_tab         text NOT NULL,                                          -- provenance, e.g. 'มิ.ย.69ยอดขายปั้ม62'

  -- Phase-2 source discriminator (POS API later writes source='pos_api', same table, no schema change).
  source            text NOT NULL DEFAULT 'ym62_sheet',

  -- Core sales
  liters            numeric(12,3),
  total_sales       numeric(15,2),
  fuel_sales        numeric(15,2),
  engine_oil_sales  numeric(15,2),

  -- Cash reconciliation (the heart of the feature)
  cash_submitted    numeric(15,2),
  cash_banked       numeric(15,2) NULL,   -- NULL = ยังไม่นำฝาก (pending deposit, not a shortage)
  cash_diff_sheet   numeric(15,2),        -- the cashDiff cell as it stands in the sheet (audited)
  cash_diff_calc    numeric(15,2),        -- = cash_banked − cash_submitted, re-derived by us
  credit            numeric(15,2),
  credit_diff       numeric(15,2),
  total_diff        numeric(15,2),

  -- Bank channel rollups
  transfer_total    numeric(15,2),        -- Σ QR across the 3 accounts
  card_total        numeric(15,2),        -- Σ card across the 3 accounts
  grand_total_both  numeric(15,2),        -- col25 (sheet's both-accounts per-shift total)

  measure_check     numeric(12,3),        -- วัดตวง
  staff_name        text,                 -- normalized เเ→แ + trimmed
  note              text,

  -- Computed server-side at upsert = single source of truth for the UI flag colour.
  recon_status      text NOT NULL DEFAULT 'ok'
                    CHECK (recon_status IN ('ok','pending_deposit','shortage','overage','mismatch')),
  anomaly_codes     jsonb NOT NULL DEFAULT '[]',

  -- Per-account QR/card-by-cutoff matrix (cols 10-36) for Phase-2 drilldown.
  bank_breakdown    jsonb NOT NULL DEFAULT '{}',
  -- Full 0..42 cell array verbatim, for forensic re-check when the CEO "ย่อยข้อมูล" later.
  raw_row           jsonb NOT NULL DEFAULT '{}',

  source_fetched_at timestamptz NULL,     -- drives "ดึงล่าสุดเมื่อ"
  imported_by_id    uuid NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Idempotent re-import key. Surrogate pump_key (not branch_id, which is nullable).
CREATE UNIQUE INDEX IF NOT EXISTS cashhub_fuel_daily_uniq
  ON public.cashhub_fuel_daily (org_id, pump_key, report_date, shift);

CREATE INDEX IF NOT EXISTS cashhub_fuel_daily_date_idx
  ON public.cashhub_fuel_daily (org_id, report_date);
CREATE INDEX IF NOT EXISTS cashhub_fuel_daily_status_idx
  ON public.cashhub_fuel_daily (org_id, recon_status);

-- RLS — same org-isolation policy as branches / daily_reports.
ALTER TABLE public.cashhub_fuel_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cashhub_fuel_daily_org_isolation ON public.cashhub_fuel_daily;
CREATE POLICY cashhub_fuel_daily_org_isolation ON public.cashhub_fuel_daily
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
