-- LedgerLine · ghost category suggestion (CEO 2026-07-24)
-- เก็บ "หมวดที่ AI เดาจากบิล" ไว้โชว์ตัวจางให้คนกดยืนยัน (ไม่ hard-set categoryId เอง).
-- forward-only · nullable · ไม่กระทบข้อมูลเดิม.
ALTER TABLE "public"."ledger_expense"
  ADD COLUMN IF NOT EXISTS "suggested_category_name" TEXT;
