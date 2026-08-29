-- ClawFleet · แนบสลิปฝากเงิน + AI อ่านยอด (เวิร์กช็อป 2026-08-29)
-- ADDITIVE ONLY: เพิ่มคอลัมน์ nullable ทั้งหมด — ไม่แตะ field เดิมของ cf_cash_deposits เลย.
-- ตรวจ "บัญชีผิด" ใช้ ocr_account_number (เลขบัญชี) เท่านั้น — ห้าม derive จาก ocr_account_name
-- (บทเรียนจาก ChairOps 2026-08-29: เทียบชื่อบัญชีติดธงเท็จ 72/75 ใบ เพราะชื่อนิติบุคคลเต็มบนสลิป
-- เขียนคนละรูปแบบกับชื่อย่อที่ตั้งค่าไว้ในระบบเสมอ — ดู lib/clawfleet/reconcile/slip-ocr.ts).

ALTER TABLE public.cf_cash_deposits
  ADD COLUMN IF NOT EXISTS ocr_amount_cents   integer,
  ADD COLUMN IF NOT EXISTS ocr_date           timestamptz(6),
  ADD COLUMN IF NOT EXISTS ocr_account_name   text,
  ADD COLUMN IF NOT EXISTS ocr_account_number text,
  ADD COLUMN IF NOT EXISTS ocr_ref_no         text,
  ADD COLUMN IF NOT EXISTS ocr_read_at        timestamptz(6),
  ADD COLUMN IF NOT EXISTS ocr_flag_reason    text;
