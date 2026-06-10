-- LedgerLine: เก็บ "ประเภทการซื้อ" ที่ AI อ่านจากบิล (goods/service/construction)
-- เพื่อให้ตอน push เข้า TRCloud เลือก SKU (JPS-100/101/103) อัตโนมัติ — ไม่ต้องตั้ง SKU มือ.
-- additive-nullable, ปลอดภัย ไม่กระทบของเดิม (NULL = push เดาจากชื่อประเภทค่าใช้จ่ายแทน).
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_purchase_type text;
