-- FuelOS · ยอดขาย/ลูกหนี้ — เพิ่มวันที่จ่ายล่าสุด (จากใบเสร็จ RV ที่อ้างถึงใบนี้)
-- "จ่ายวันไหน" = max(วันออกใบเสร็จ RV ที่ reference = doc_no ของใบนี้)
ALTER TABLE fuel.sales_invoices ADD COLUMN IF NOT EXISTS paid_date date;
CREATE INDEX IF NOT EXISTS sales_invoices_org_docno_idx ON fuel.sales_invoices (org_id, doc_no);
