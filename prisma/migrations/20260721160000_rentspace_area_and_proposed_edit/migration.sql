-- RentSpace: ขนาดพื้นที่กรอกในสัญญา + ข้อความที่ขอแก้รออนุมัติ (redline) — additive idempotent
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "area_sqm" DECIMAL(10,2);
ALTER TABLE "rental_contract" ADD COLUMN IF NOT EXISTS "edit_proposed_body_html" TEXT;
