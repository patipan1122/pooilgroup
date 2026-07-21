-- LedgerLine · PO→AP conversion — เก็บเลขเอกสาร AP ที่ลงบัญชีจริงใน TRCloud (แยกจาก PO ตั้งต้น).
-- Additive · nullable · schema public · ไม่กระทบใบเก่า.
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_ap_doc_id text,
  ADD COLUMN IF NOT EXISTS trcloud_ap_doc_no text,
  ADD COLUMN IF NOT EXISTS trcloud_ap_at     timestamptz,
  ADD COLUMN IF NOT EXISTS trcloud_ap_error  text;
