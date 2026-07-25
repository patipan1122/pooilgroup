-- LedgerLine · PV (ใบสำคัญจ่าย) — เก็บเลขเอกสาร PV ที่ลงบัญชีจ่ายจริงใน TRCloud
-- ต่อ 1 คำขอโอน (1 โอน = 1 PV อ้างหลาย AP). pv_source_bank = ธนาคารต้นทาง (จากสลิป)
-- ที่ใช้เลือกสูตร PV บัญชีเงินสด/ธนาคาร. Additive · nullable · schema public · ไม่กระทบใบเก่า.
ALTER TABLE public.ledger_payment_request
  ADD COLUMN IF NOT EXISTS trcloud_pv_doc_id text,
  ADD COLUMN IF NOT EXISTS trcloud_pv_doc_no text,
  ADD COLUMN IF NOT EXISTS trcloud_pv_at     timestamptz,
  ADD COLUMN IF NOT EXISTS trcloud_pv_error  text,
  ADD COLUMN IF NOT EXISTS pv_source_bank    text;
