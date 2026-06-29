-- ClawFleet · ตู้คีบ OS — คำขอตั้งค่าตู้ (machine config approval queue)
-- Additive only · idempotent (IF NOT EXISTS / duplicate_object guard) · apply to prod BEFORE deploy (schema-applied gate)
-- พนักงานเสนอปรับความแรงคีบ/ราคา → PENDING → เจ้าของอนุมัติ/ตีกลับ.
-- snapshot machine_code/branch_name/submitted_by_name เผื่อลบของจริงแล้วประวัติยังอ่านได้.
-- 2026-06-29

-- ─────────────────────────────────────────────────────────────
-- cf_config_requests
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."cf_config_requests" (
  "id"                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"             uuid        NOT NULL,
  "branch_id"          uuid        NOT NULL,
  "machine_id"         uuid,
  "machine_code"       text        NOT NULL,
  "branch_name"        text        NOT NULL,
  "product_name"       text,
  "claw_from"          integer,
  "claw_to"            integer,
  "price_baht"         integer,
  "reason"             text        NOT NULL,
  "status"             text        NOT NULL DEFAULT 'PENDING',
  "submitted_by_id"    uuid        NOT NULL,
  "submitted_by_name"  text,
  "submitted_at"       timestamptz NOT NULL DEFAULT now(),
  "reviewed_by_id"     uuid,
  "reviewed_by_name"   text,
  "reviewed_at"        timestamptz,
  "review_note"        text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cf_config_requests_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "public"."cf_config_requests"
    ADD CONSTRAINT "cf_config_requests_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_config_requests"
    ADD CONSTRAINT "cf_config_requests_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_config_requests"
    ADD CONSTRAINT "cf_config_requests_machine_id_fkey"
    FOREIGN KEY ("machine_id") REFERENCES "public"."cf_machines"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_config_requests"
    ADD CONSTRAINT "cf_config_requests_submitted_by_id_fkey"
    FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."cf_config_requests"
    ADD CONSTRAINT "cf_config_requests_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cf_config_requests_org_id_status_idx" ON "public"."cf_config_requests" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "cf_config_requests_org_id_branch_id_idx" ON "public"."cf_config_requests" ("org_id", "branch_id");
