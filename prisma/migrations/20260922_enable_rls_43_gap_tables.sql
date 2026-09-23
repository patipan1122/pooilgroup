-- Fixes Supabase Security Advisor CRITICAL alerts (2026-09-19):
--   rls_disabled_in_public + sensitive_columns_exposed
-- 43 public tables across RentSpace/ClawFleet-v2/ClawHub/LedgerLine were
-- created (2026-05 .. 2026-06) without ever enabling Row Level Security.
-- Verified via grep: no app code queries any of these tables through the
-- browser/anon Supabase client (lib/supabase/client.ts, lib/db/client.ts
-- have zero importers with .from() calls) — every read/write goes through
-- Prisma or the service-role admin client, both of which bypass RLS as
-- table owner. Enabling RLS with no policy = default-deny for the public
-- API key, zero change for the app itself.

-- RentSpace (17 tables) — includes rental_tenant: unmasked Thai national ID,
-- phone, address, tax ID, DOB. Top candidate for sensitive_columns_exposed.
ALTER TABLE public.rental_announcement       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_bill               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_bill_item          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_building           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contract           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contract_addendum  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contract_template  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_deposit            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_discount           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_document           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_meter              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_meter_reading      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_payment            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_project            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_recurring_charge   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_tenant             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_unit               ENABLE ROW LEVEL SECURITY;

-- ClawHub loyalty (7 tables) — clawhub_members: full name, phone, DOB,
-- address, LINE id.
ALTER TABLE public.clawhub_conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_point_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_redemptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_refund_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clawhub_rewards           ENABLE ROW LEVEL SECURITY;

-- ClawFleet v2 (17 tables) — financial/ops data (deposits, receipts,
-- stock counts, repairs).
ALTER TABLE public.cf_branch_checklist_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_branch_reconcile_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_branch_return_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_branch_returns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_cash_deposits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_config_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_delivery_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_goods_receipt_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_goods_receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_loss_docs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_loss_lines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_repair_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_repair_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_staff_machine_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_stock_count_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_stock_counts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_warehouses             ENABLE ROW LEVEL SECURITY;

-- LedgerLine (2 tables)
ALTER TABLE public.ledger_installment        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_project            ENABLE ROW LEVEL SECURITY;
