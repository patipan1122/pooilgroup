-- Playland · พนักงานประจำสาขา (staff ↔ branch) — จำกัดให้เห็น/ทำเฉพาะสาขาตัวเอง
-- Additive · idempotent · apply to prod BEFORE deploy (schema-applied gate)
-- 2026-06-24

CREATE TABLE IF NOT EXISTS "playland"."staff_branches" (
  "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"     uuid        NOT NULL,
  "user_id"    uuid        NOT NULL,
  "branch_id"  uuid        NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "staff_branches_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "playland"."staff_branches"
    ADD CONSTRAINT "staff_branches_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "playland"."branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "staff_branches_user_id_branch_id_key" ON "playland"."staff_branches" ("user_id", "branch_id");
CREATE INDEX IF NOT EXISTS "staff_branches_org_id_user_id_idx" ON "playland"."staff_branches" ("org_id", "user_id");
CREATE INDEX IF NOT EXISTS "staff_branches_branch_id_idx" ON "playland"."staff_branches" ("branch_id");
