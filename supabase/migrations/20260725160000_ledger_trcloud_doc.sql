-- LedgerLine · สำเนา PO/AP จาก TRCloud (อ่านอย่างเดียว · TRCloud = ต้นฉบับ · เราเก็บ snapshot).
--
-- ทำไมต้อง cache: TRCloud rate-limit ~8-10 call/burst + ตัวกรองวันที่ฝั่งมันพัง (เมิน date_from/limit/page,
-- คืน ≤100 แถวเสมอ). ดึงสดทุกครั้ง = ช้า+โดนบล็อก. จึงเลื่อนหน้าด้วย start= แล้วเก็บ snapshot,
-- เปิดหน้า browse/filter จาก DB เรา, กด "รีเฟรช" เพื่อ sync รอบใหม่. (เหมือน fuel.sales_invoices)
--
-- org-level: TRCloud company 45 (JPS GROUP) ครอบทุกนิติบุคคล → แยกด้วย company_format/department/project.
-- Purely additive + idempotent — ไม่แตะตารางเดิม.

CREATE TABLE IF NOT EXISTS public.ledger_trcloud_doc (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  kind               text        NOT NULL,             -- 'PO' | 'AP'
  trcloud_id         text        NOT NULL,             -- po_id หรือ expense_id
  trcloud_company_id text,                             -- TRCloud company (เช่น '45')
  company_format     text,                             -- ชุดเลข: JPS_AP·JPS_EXP·PO·PATI_AP·YM_AP·JANE_AP
  doc_number         text,                             -- invoice_number / document_number
  ref_no             text,                             -- ref_no เต็ม เช่น JPS_EXP2607250003
  trcloud_reference  text,                             -- field reference ของ TRCloud = docCode ตอน LedgerLine push (จับคู่แหล่งที่มา)
  issue_date         timestamptz,
  vendor_name        text,
  organization       text,
  tax_id             text,
  department         text,                             -- นิติบุคคล
  project            text,                             -- สาขา
  status             text,                             -- Debtor·New·Paid...
  status_ap          text,                             -- PO: แปลงเป็น AP แล้วยัง (0=ยัง)
  total              numeric(15,2),
  grand_total        numeric(15,2),
  tax                numeric(15,2),
  wht                numeric(15,2),
  discount           numeric(15,2),
  payment            numeric(15,2),
  staff              text,
  invoice_note       text,
  tax_option         text,
  pdf_url            text,
  pr_no              text,                             -- PO: PR ต้นทาง
  trcloud_created_at timestamptz,
  trcloud_updated_at timestamptz,
  raw                jsonb,
  synced_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ป้องกันซ้ำตอน re-sync: หนึ่งเอกสาร TRCloud = หนึ่งแถว (ต่อ org + kind).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_trcloud_doc_org_kind_id_key
  ON public.ledger_trcloud_doc (org_id, kind, trcloud_id);

-- ดัชนีสำหรับกรอง/เรียง 4 แกน + วันที่.
CREATE INDEX IF NOT EXISTS ledger_trcloud_doc_org_kind_date_idx
  ON public.ledger_trcloud_doc (org_id, kind, issue_date);
CREATE INDEX IF NOT EXISTS ledger_trcloud_doc_org_kind_format_idx
  ON public.ledger_trcloud_doc (org_id, kind, company_format);
CREATE INDEX IF NOT EXISTS ledger_trcloud_doc_org_department_idx
  ON public.ledger_trcloud_doc (org_id, department);
CREATE INDEX IF NOT EXISTS ledger_trcloud_doc_org_project_idx
  ON public.ledger_trcloud_doc (org_id, project);

-- RLS — org-isolation เดียวกับ ledger ทั้งโมดูล.
ALTER TABLE public.ledger_trcloud_doc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_trcloud_doc_org_isolation" ON public.ledger_trcloud_doc;
CREATE POLICY "ledger_trcloud_doc_org_isolation" ON public.ledger_trcloud_doc
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

COMMENT ON TABLE public.ledger_trcloud_doc IS
  'LedgerLine snapshot ของ PO/AP จาก TRCloud (อ่านอย่างเดียว). เลื่อนหน้าด้วย start=, กรองวันที่ฝั่ง app. แยกด้วย company_format(ชุดเลข)/department(นิติบุคคล)/project(สาขา).';
