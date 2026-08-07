-- RentSpace audit fix (2026-08-07)
-- P0-1: "แช่แข็ง" อัตรา VAT ลงบิล — เดิม recomputeBillTotals อ่าน vatPercent สดจากสัญญา
--       ทำให้บิล/ใบกำกับภาษีที่ออกไปแล้วเปลี่ยนยอดเมื่อแก้ vatPercent ในสัญญาย้อนหลัง
-- backfill ใบเก่าจาก contract.vat_percent ปัจจุบัน (best-effort — ไม่มีประวัติเรตเดิม)
ALTER TABLE "public"."rental_bill"
  ADD COLUMN IF NOT EXISTS "vat_percent" numeric(6,3) NOT NULL DEFAULT 0;

UPDATE "public"."rental_bill" b
  SET "vat_percent" = COALESCE(c."vat_percent", 0)
  FROM "public"."rental_contract" c
  WHERE b."contract_id" = c."id" AND b."vat_percent" = 0;

-- CEO 2026-08-07: ค่าเช่า = ยกเว้น VAT · น้ำ/ไฟ = คิด VAT
-- แก้เฉพาะ DEFAULT ของคอลัมน์ (กระทบเฉพาะโครงการที่สร้างใหม่) — row เดิมไม่แตะ
ALTER TABLE "public"."rental_project" ALTER COLUMN "vat_on_rent"     SET DEFAULT false;
ALTER TABLE "public"."rental_project" ALTER COLUMN "vat_on_electric" SET DEFAULT true;
ALTER TABLE "public"."rental_project" ALTER COLUMN "vat_on_water"    SET DEFAULT true;
