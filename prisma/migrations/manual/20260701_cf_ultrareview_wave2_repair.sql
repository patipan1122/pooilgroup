-- ClawOS · ultrareview Wave 2 — ระบบแจ้งซ่อม + rebaseline มิเตอร์หลังซ่อม (2026-07-01)
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code (schema-gate).
-- แก้: ช่างซ่อมไม่มีที่ยืน (3/10) + โดนหาว่าโกงหลังเปลี่ยนมิเตอร์ (rebaseline maker-checker).
-- machine.isActive / lastCoinMeter / lastDollStock มีอยู่แล้ว → ไม่ต้องเพิ่มคอลัมน์ machine.

CREATE TABLE IF NOT EXISTS public.cf_repair_tickets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  branch_id              uuid NOT NULL,
  machine_id             uuid NOT NULL,
  machine_code           text NOT NULL,
  symptom                text NOT NULL,
  note                   text,
  photo_urls             text[] NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'OPEN',
  reported_by_id         uuid,
  reported_by_name       text NOT NULL,
  reported_at            timestamptz NOT NULL DEFAULT now(),
  meter_reset_requested  boolean NOT NULL DEFAULT false,
  proposed_coin_meter    integer,
  proposed_doll_stock    integer,
  meter_applied_at       timestamptz,
  resolved_by_id         uuid,
  resolved_by_name       text,
  resolved_at            timestamptz,
  resolution_note        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_repair_tickets_org_status_idx    ON public.cf_repair_tickets (org_id, status, reported_at DESC);
CREATE INDEX IF NOT EXISTS cf_repair_tickets_org_machine_idx   ON public.cf_repair_tickets (org_id, machine_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS cf_repair_tickets_org_branch_idx    ON public.cf_repair_tickets (org_id, branch_id, status);

-- FK machine (integrity · cascade เมื่อลบตู้) — เพิ่มเฉพาะถ้ายังไม่มี
DO $$ BEGIN
  ALTER TABLE public.cf_repair_tickets
    ADD CONSTRAINT cf_repair_tickets_machine_fk
    FOREIGN KEY (machine_id) REFERENCES public.cf_machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cf_repair_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  ticket_id   uuid NOT NULL,
  action      text NOT NULL,
  by_id       uuid,
  by_name     text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_repair_logs_org_ticket_idx ON public.cf_repair_logs (org_id, ticket_id, created_at);

DO $$ BEGIN
  ALTER TABLE public.cf_repair_logs
    ADD CONSTRAINT cf_repair_logs_ticket_fk
    FOREIGN KEY (ticket_id) REFERENCES public.cf_repair_tickets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
