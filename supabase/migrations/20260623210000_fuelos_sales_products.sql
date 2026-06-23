-- FuelOS · ยอดขาย/ลูกหนี้ — เก็บรายการสินค้าในบิล (ชื่อสินค้า/ลิตร/ราคา) จาก iv/read.php
-- ดึงตอนกดดูบิล (lazy) เก็บไว้กันดึงซ้ำ · null = ยังไม่เคยดึง
ALTER TABLE fuel.sales_invoices ADD COLUMN IF NOT EXISTS products jsonb;
