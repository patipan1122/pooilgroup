-- LedgerLine · ตั้งชื่อเรียกใบค่าใช้จ่าย (title) — โชว์แทน docCode (EXP-YYYYMM-NNNN) เมื่อมี.
-- Additive · nullable · schema public · ไม่กระทบใบเก่า (null = ใช้ docCode เหมือนเดิม).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS title text;
