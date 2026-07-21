-- RentSpace: เวอร์ชันแม่แบบสัญญา (v1/v2/v3…) — additive + idempotent
ALTER TABLE "rental_contract_template" ADD COLUMN IF NOT EXISTS "family_key" TEXT;
ALTER TABLE "rental_contract_template" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "rental_contract_template" ADD COLUMN IF NOT EXISTS "changelog" TEXT;
CREATE INDEX IF NOT EXISTS "rental_contract_template_org_id_family_key_version_idx"
  ON "rental_contract_template"("org_id", "family_key", "version");
