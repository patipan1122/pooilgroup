-- RentSpace → LedgerLine: บัญชีธนาคารที่ยอดบิลที่จ่ายครบแล้วควรเข้า (2026-08-17)
-- companyId มีอยู่แล้วใน rental_project (ไม่เคยผูก UI) ใช้เป็น company_id คู่กัน
ALTER TABLE "public"."rental_project"
  ADD COLUMN IF NOT EXISTS "reconcile_bank_account_id" uuid;
