-- CEO 2026-08-29: เพิ่มคอลัมน์เก็บเลขบัญชีปลายทางที่ AI อ่านจากสลิป — ใช้แทน
-- ocrAccountName ในการตรวจ "บัญชีผิด" (checkSlipFraud) เพราะชื่อนิติบุคคลเต็มที่
-- AI อ่านได้ เขียนคนละรูปแบบกับชื่อย่อในระบบเสมอ ทำให้ติดธงเท็จเกือบทุกใบ
-- (ยืนยันจริง 73/73 ใบที่เคยติดธงจากเช็คนี้).
ALTER TABLE chairops."ChairopsCashDeposit"
  ADD COLUMN IF NOT EXISTS "ocrAccountNumber" TEXT;
