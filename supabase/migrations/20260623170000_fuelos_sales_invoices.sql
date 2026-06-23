-- FuelOS · ยอดขาย/ลูกหนี้ — ดึงใบกำกับภาษีจาก TRCloud บริษัท 44 (ขายส่งน้ำมันทั้งหมด)
-- อ่านอย่างเดียวจาก TRCloud · เก็บ snapshot โชว์ยอดขายรายลูกค้า + จ่ายแล้ว/ค้าง/จ่ายบางส่วน
-- ค้างชำระ = grand_total − paid_amount (TRCloud ส่ง payment มากับใบ → จ่ายบางส่วนแม่น)
-- fuel schema กรอง org_id ใน app (ไม่ใช้ RLS เหมือน public)

CREATE TABLE IF NOT EXISTS fuel.sales_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  trcloud_invoice_id text NOT NULL,
  company_format     text,
  invoice_number     text NOT NULL,
  doc_no             text NOT NULL,
  contact_id         text,
  customer_name      text NOT NULL,
  customer_org       text,
  customer_branch    text,
  customer_tax_id    text,
  issue_date         date NOT NULL,
  due_date           date,
  net_total          numeric(15,2) NOT NULL DEFAULT 0,
  vat_total          numeric(15,2) NOT NULL DEFAULT 0,
  grand_total        numeric(15,2) NOT NULL DEFAULT 0,
  paid_amount        numeric(15,2) NOT NULL DEFAULT 0,
  outstanding        numeric(15,2) NOT NULL DEFAULT 0,
  trcloud_status     text,
  payment_state      text NOT NULL DEFAULT 'UNPAID',
  salesman           text,
  department         text,
  project            text,
  doc_type           text,
  quantity           numeric(15,3) NOT NULL DEFAULT 0,
  issued_at          timestamptz,
  raw_json           jsonb,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoices_org_fk FOREIGN KEY (org_id) REFERENCES fuel.orgs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_org_trcloud_key  ON fuel.sales_invoices (org_id, trcloud_invoice_id);
CREATE INDEX        IF NOT EXISTS sales_invoices_org_issue_idx     ON fuel.sales_invoices (org_id, issue_date);
CREATE INDEX        IF NOT EXISTS sales_invoices_org_state_idx     ON fuel.sales_invoices (org_id, payment_state);
CREATE INDEX        IF NOT EXISTS sales_invoices_org_contact_idx   ON fuel.sales_invoices (org_id, contact_id);
