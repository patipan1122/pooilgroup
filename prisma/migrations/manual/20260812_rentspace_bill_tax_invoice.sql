-- RentSpace: ปุ่ม "ออกใบกำกับภาษี" สำหรับบิลที่จ่ายครบแล้ว (2026-08-12)
-- เลขที่ต้องเรียงต่อเนื่องไม่ข้าม/ไม่ซ้ำตามกฎสรรพากร → ออกครั้งเดียวแล้วแช่แข็งถาวร
ALTER TABLE "public"."rental_bill"
  ADD COLUMN IF NOT EXISTS "tax_invoice_no" text,
  ADD COLUMN IF NOT EXISTS "tax_invoice_issued_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "tax_invoice_issued_by" uuid;

-- unique ต่อ org (NULL ไม่ชนกันเอง — บิลที่ยังไม่ออกใบกำกับภาษีไม่กระทบ)
CREATE UNIQUE INDEX IF NOT EXISTS "rental_bill_org_id_tax_invoice_no_key"
  ON "public"."rental_bill" ("org_id", "tax_invoice_no");
