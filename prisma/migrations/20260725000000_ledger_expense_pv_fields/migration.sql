-- LedgerLine · จ่าย AP → ใบสำคัญจ่าย PV (payment voucher) — เก็บเลขเอกสาร PV ที่ลงบัญชีจ่ายเงินจริงใน TRCloud.
-- PV posts: Dr เจ้าหนี้ 2101000 / Cr บัญชีธนาคารที่จ่าย (เลือกจาก type label เช่น SCB[PV]→1013000).
-- Additive · nullable · schema public · ไม่กระทบใบเก่า.
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_pv_doc_id text,
  ADD COLUMN IF NOT EXISTS trcloud_pv_doc_no text,
  ADD COLUMN IF NOT EXISTS trcloud_pv_at     timestamptz,
  ADD COLUMN IF NOT EXISTS trcloud_pv_error  text;
