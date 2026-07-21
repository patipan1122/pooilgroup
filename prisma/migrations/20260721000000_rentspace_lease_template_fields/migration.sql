-- RentSpace: แม่แบบสัญญาเช่ามาตรฐาน — ช่องกรอกเพิ่ม + ค่ารายเดือน per-contract
-- Additive + idempotent (IF NOT EXISTS) → ปลอดภัยรันซ้ำ · ไม่กระทบสัญญาเก่า (ทุกคอลัมน์ nullable)

-- ผู้มีอำนาจลงนามแทน (ผู้เช่านิติบุคคล)
ALTER TABLE "rental_tenant" ADD COLUMN IF NOT EXISTS "authorized_signer_name" TEXT;
ALTER TABLE "rental_tenant" ADD COLUMN IF NOT EXISTS "authorized_signer_phone" TEXT;

-- ช่องกรอกสำหรับแม่แบบสัญญามาตรฐาน
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "business_type" TEXT;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "trade_name" TEXT;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "renewal_notice_days" INTEGER;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "termination_notice_days" INTEGER;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "fit_out_free_days" INTEGER;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "building_modifications" TEXT;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "witness2_name" TEXT;

-- ค่ารายเดือนกรอกแยกทุกสัญญา (per-contract) — บวกเข้าบิลอัตโนมัติเหมือน recurring charge เดิม
ALTER TABLE "rental_recurring_charge" ADD COLUMN IF NOT EXISTS "contract_id" UUID;
CREATE INDEX IF NOT EXISTS "rental_recurring_charge_contract_id_idx" ON "rental_recurring_charge"("contract_id");
DO $$ BEGIN
  ALTER TABLE "rental_recurring_charge"
    ADD CONSTRAINT "rental_recurring_charge_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "rental_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
