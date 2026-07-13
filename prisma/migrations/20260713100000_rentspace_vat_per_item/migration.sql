-- RentSpace: เลือกได้ว่ารายการไหน "คิด VAT" (ค่าเช่า/ค่าไฟ/ค่าน้ำ)
-- ระดับโครงการ = ค่าเริ่มต้น · ระดับสัญญา (รายห้อง) = แก้ทับได้ (null = ตามโครงการ)
-- Additive + IF NOT EXISTS = ปลอดภัย ไม่กระทบข้อมูล/บิลเดิม (default คงพฤติกรรมเดิม: VAT ลงค่าเช่า)

ALTER TABLE "rental_project" ADD COLUMN IF NOT EXISTS "vat_on_rent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rental_project" ADD COLUMN IF NOT EXISTS "vat_on_electric" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rental_project" ADD COLUMN IF NOT EXISTS "vat_on_water" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "vat_on_rent" BOOLEAN;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "vat_on_electric" BOOLEAN;
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "vat_on_water" BOOLEAN;
