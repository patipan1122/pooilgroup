-- ChairOps · เลขที่รายการบนสลิป (CEO 2026-08-18 · ตัวชี้ขาดสลิปซ้ำที่แม่นกว่า
-- วันที่+ยอด) — ADDITIVE · nullable · ของเดิมไม่กระทบ.
ALTER TABLE chairops."ChairopsCashDeposit"
  ADD COLUMN IF NOT EXISTS "ocrRefNo" TEXT;
