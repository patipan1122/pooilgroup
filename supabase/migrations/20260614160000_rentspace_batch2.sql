-- RentSpace Batch 2 — additive columns (safe; nullable / defaulted, no data loss)
-- Adopts from Horganice: meter rollover/replace, per-line VAT, bill tax header, send-bill tracking.

-- meter rollover / replacement (usage = (old_meter_final - prev) + curr when is_reset)
ALTER TABLE public.rental_meter_reading
  ADD COLUMN IF NOT EXISTS is_reset boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS old_meter_final numeric(15,2);

-- per-line VAT toggle on bill items
ALTER TABLE public.rental_bill_item
  ADD COLUMN IF NOT EXISTS vatable boolean NOT NULL DEFAULT false;

-- bill tax header (for corporate tenants' full tax invoices)
ALTER TABLE public.rental_project
  ADD COLUMN IF NOT EXISTS bill_company_name text,
  ADD COLUMN IF NOT EXISTS bill_tax_id text,
  ADD COLUMN IF NOT EXISTS bill_branch text,
  ADD COLUMN IF NOT EXISTS bill_address text;

-- send-bill + overdue-reminder tracking + public share token
ALTER TABLE public.rental_bill
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "rental_bill_public_token_key"
  ON public.rental_bill(public_token);
