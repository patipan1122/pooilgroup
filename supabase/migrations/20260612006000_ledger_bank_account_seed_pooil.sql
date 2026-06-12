-- LedgerLine — Bank account schema extension + production seed (Pooil Group).
-- Source: CEO master sheet (Google Sheets, 2026-06-12) — 26 real bank accounts.
--
-- This migration is ADDITIVE + future-proof:
--   1. Extend bank_code to cover GSB (ออมสิน) + TRUEMONEY (wallet)
--   2. Add legal_entity (true owning company, may differ from reconcile company)
--      + flow_type (cash/transfer/QR/EDC — used as a matching hint + grouping)
--   3. Natural-key unique index so re-running the seed is idempotent
--   4. Seed all 26 accounts + map every account to JP Sync Group for a unified
--      "see every baht" reconcile hub. legal_entity preserves the real owner so
--      Pooil Oil / วีดิค / วายเอ็มพลัส can be split into their own company scope later.

-- ============================================================
-- 1. Extend bank_code constraint (GSB + TRUEMONEY)
-- ============================================================
ALTER TABLE public.ledger_bank_account DROP CONSTRAINT IF EXISTS chk_bank_code;
ALTER TABLE public.ledger_bank_account ADD CONSTRAINT chk_bank_code
  CHECK (bank_code IN ('KBANK','SCB','TTB','BBL','BAAC','KTB','BAY','GSB','CIMB','UOB','TRUEMONEY','OTHER'));

-- ============================================================
-- 2. New columns: legal_entity + flow_type
-- ============================================================
ALTER TABLE public.ledger_bank_account ADD COLUMN IF NOT EXISTS legal_entity varchar(200);
ALTER TABLE public.ledger_bank_account ADD COLUMN IF NOT EXISTS flow_type    varchar(60);

-- ============================================================
-- 3. Natural-key uniqueness (idempotent seed + prevent dup accounts)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_account_natural_uniq
  ON public.ledger_bank_account (org_id, bank_code, account_no);

-- ============================================================
-- 4. Seed 26 accounts
--    org POOIL GROUP = 00000000-0000-0000-0000-000000000001
-- ============================================================
INSERT INTO public.ledger_bank_account
  (org_id, bank_code, account_no, account_name, account_type, legal_entity, flow_type, is_active)
VALUES
  -- กรุงเทพ BBL — บจก.เจพีซิ้ง กรู๊ป
  ('00000000-0000-0000-0000-000000000001','BBL','594-0-959934','ฝากเงินสด ชาโนนคอย/รังกา/ชุมพวง/ตลาดแค/พิมาย/แดง + Amazon + ลูกชิ้น','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',true),
  ('00000000-0000-0000-0000-000000000001','BBL','594-0-933335','โรงแรมมิกซ์','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',true),
  ('00000000-0000-0000-0000-000000000001','BBL','477-415220-3','กาแฟพันธุ์ไทย สาขาโคกสูง','savings','บจก.วีดิค','เงินสด',true),
  -- ธกส BAAC — บจก.เจพีซิ้ง กรู๊ป
  ('00000000-0000-0000-0000-000000000001','BAAC','20204672649','ชาลำทะเมนชัย','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',true),
  ('00000000-0000-0000-0000-000000000001','BAAC','202249689386','ร้านชาแคนดง (K''Pim เปิดบัญชี)','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',true),
  ('00000000-0000-0000-0000-000000000001','BAAC','000820884202','ลูกชิ้นโนนแดง','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',true),
  -- กสิกรไทย KBANK
  ('00000000-0000-0000-0000-000000000001','KBANK','132-8-17-2751','โนนแดง/ลำทะเมน/ท่าช้าง/โนนคอย/รังกา/ชุมพวง','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอน QR/เครดิต',true),
  ('00000000-0000-0000-0000-000000000001','KBANK','093-8-69-1657','Amazon ตลาดจักราช','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอน QR/เครดิต',true),
  ('00000000-0000-0000-0000-000000000001','KBANK','209-2-85-4348','กาแฟพันธุ์ไทย สาขาโคกสูง','savings','บจก.วีดิค','เงินโอน QR/เครดิต',true),
  ('00000000-0000-0000-0000-000000000001','KBANK','198396-0886','ลูกชิ้น + อเมซอนชุมชน','savings','บจก.วายเอ็มพลัส','คิวอาร์ Payment/เงินสด',true),
  -- ทหารไทย TTB
  ('00000000-0000-0000-0000-000000000001','TTB','609-2-583134','ปั๊ม62 หลังโลตัสหัวทะเล','savings','บจก.วายเอ็มพลัส','ฝากเงินสด/เงินโอน QR/เครดิต',true),
  ('00000000-0000-0000-0000-000000000001','TTB','610-106-4274','โนนแดง/ลำทะเมน/ท่าช้าง/โนนคอย/รังกา/ชุมพวง/แคนดง/ตลาดแค','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอน QR/delivery',true),
  ('00000000-0000-0000-0000-000000000001','TTB','610286-3450','เก้าอี้นวด (ล่าสุด)','savings','บจก.เจพีซิ้ง กรู๊ป','เงินสด',true),
  ('00000000-0000-0000-0000-000000000001','TTB','610286-3468','เงินสดตู้คีบทุกสาขา + smart shop โรงแรม','savings','บจก.เจพีซิ้ง กรู๊ป','เงินสด+QR',true),
  -- ไทยพาณิชย์ SCB
  ('00000000-0000-0000-0000-000000000001','SCB','813-409-4107','พื้นที่เช่า คชจ K''PIM','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอนพื้นที่เช่า',true),
  ('00000000-0000-0000-0000-000000000001','SCB','813-435082-0','ตู้คีบ','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอน',true),
  ('00000000-0000-0000-0000-000000000001','SCB','813-435-0812','เก้าอี้นวด','savings','บจก.เจพีซิ้ง กรู๊ป','เงินโอน',true),
  ('00000000-0000-0000-0000-000000000001','SCB','813-435083-8','เงินฝากตู้คีบ','savings','บจก.เจพีซิ้ง กรู๊ป','เงินฝากตู้คีบ',true),
  -- ออมสิน GSB — บจก.พีโอออยล์
  ('00000000-0000-0000-0000-000000000001','GSB','020232751187','โรงแรม Mix','savings','บจก.พีโอออยล์','เงินโอนโรงแรม',true),
  -- กสิกร EDC (card terminal) — บจก.วายเอ็มพลัส
  ('00000000-0000-0000-0000-000000000001','KBANK','220-8-79234-5','ปั๊ม62 EDC (MID401014932714001)','card_terminal','บจก.วายเอ็มพลัส','EDC',true),
  -- กรุงไทย KTB — ส่วนบุคคล (คนละครึ่ง)
  ('00000000-0000-0000-0000-000000000001','KTB','3740835036','คนละครึ่ง คุณจินนี่ — ชา ท่าช้าง/โนนแดง/ลำทะเมน','savings','ส่วนบุคคล','คนละครึ่ง',true),
  ('00000000-0000-0000-0000-000000000001','KTB','6600709022','คนละครึ่ง คุณพิม — ชา โนนคอย/ชุมพวง/พิมาย + ลูกชิ้น','savings','ส่วนบุคคล','คนละครึ่ง',true),
  -- ทรูมันนี่ wallet + BBL ส่วนตัว (เลขบางส่วน — ใส่ครบทีหลัง)
  ('00000000-0000-0000-0000-000000000001','TRUEMONEY','1594','Wallet คุณจินนี่ (ทรูมันนี่)','savings','ส่วนบุคคล','Wallet',true),
  ('00000000-0000-0000-0000-000000000001','BBL','7775','บัญชีค่าใช้จ่ายคุณจินนี่','savings','ส่วนบุคคล','ค่าใช้จ่าย',true),
  -- ยกเลิกแล้ว (เก็บประวัติ — is_active=false)
  ('00000000-0000-0000-0000-000000000001','BBL','5940959918','Amazon ตลาดจักราช (ยกเลิกใช้ 24/02/69)','savings','บจก.เจพีซิ้ง กรู๊ป','ฝากเงินสด',false),
  ('00000000-0000-0000-0000-000000000001','BBL','5954250923','เงินสดร้านลูกชิ้น จักราช/ตลาดแค1+2/ชุมพวง (ยกเลิกใช้ 27/02/69)','savings','บจก.เจพีซิ้ง กรู๊ป','เงินสด',false)
ON CONFLICT (org_id, bank_code, account_no) DO NOTHING;

-- ============================================================
-- 5. Map every account → JP Sync Group (unified reconcile hub)
--    JP Sync Group = 00000000-0000-0000-0000-0000000000a2
-- ============================================================
INSERT INTO public.ledger_bank_account_company
  (org_id, bank_account_id, company_id, can_import, can_view)
SELECT
  a.org_id, a.id, '00000000-0000-0000-0000-0000000000a2'::uuid, true, true
FROM public.ledger_bank_account a
WHERE a.org_id = '00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT (bank_account_id, company_id) DO NOTHING;
