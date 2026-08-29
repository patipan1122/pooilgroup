-- RentSpace: ค่าเช่า/ส่วนลดต้อง super_admin อนุมัติก่อนมีผลจริง + AI อ่านสลิปอัตโนมัติ (2026-08-29)
-- rentAmountThb/promoDiscountThb บน rental_contract ยังคงเป็น "ค่าที่อนุมัติแล้ว" เท่านั้น (ใช้คิดบิลจริง)
-- แยก track รายการเช่า/ส่วนลด อิสระจากกัน เพราะ actUpdateContractBilling แก้ส่วนลดได้โดยไม่แตะค่าเช่า

ALTER TABLE "public"."rental_contract"
  ADD COLUMN IF NOT EXISTS "pending_rent_amount_thb" numeric(15, 2),
  ADD COLUMN IF NOT EXISTS "rent_approval_status" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "rent_requested_by" uuid,
  ADD COLUMN IF NOT EXISTS "rent_requested_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rent_decided_by" uuid,
  ADD COLUMN IF NOT EXISTS "rent_decided_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rent_decision_note" text,
  ADD COLUMN IF NOT EXISTS "pending_promo_discount_thb" numeric(15, 2),
  ADD COLUMN IF NOT EXISTS "discount_approval_status" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "discount_requested_by" uuid,
  ADD COLUMN IF NOT EXISTS "discount_requested_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "discount_decided_by" uuid,
  ADD COLUMN IF NOT EXISTS "discount_decided_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "discount_decision_note" text;

-- AI อ่านสลิปอัตโนมัติหลังบันทึกจ่าย (mirror ChairopsCashDeposit ocr* columns) — internal only
ALTER TABLE "public"."rental_payment"
  ADD COLUMN IF NOT EXISTS "ocr_amount" integer,
  ADD COLUMN IF NOT EXISTS "ocr_date" date,
  ADD COLUMN IF NOT EXISTS "ocr_account_name" text,
  ADD COLUMN IF NOT EXISTS "ocr_ref_no" text,
  ADD COLUMN IF NOT EXISTS "ocr_read_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "ocr_flag_reason" text,
  ADD COLUMN IF NOT EXISTS "requires_review" boolean NOT NULL DEFAULT false;
