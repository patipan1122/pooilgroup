-- LedgerLine · P2 — เงินประกันผลงาน (retention) display-only. Additive · schema public.
-- % หักไว้ทุกงวด (เช่น 5%) · 0 = ไม่มี. ไม่มี engine คืนอัตโนมัติ (แค่โชว์ยอดคงค้าง).
ALTER TABLE public.ledger_project
  ADD COLUMN IF NOT EXISTS retention_pct numeric(5,2) NOT NULL DEFAULT 0;
