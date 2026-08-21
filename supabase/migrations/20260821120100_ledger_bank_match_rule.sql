-- LedgerLine Bank Recon — override กฎแมตช์ต่อบัญชี (2026-08-21)
-- CEO (ร้านชาไข่มุก): QR ต้องแมตช์ "วันเดียวกันเท่านั้น" (กันมั่วยอดใกล้เคียงกันข้ามวัน) ส่วนเงินสด
-- ยังอยากให้ข้ามวันได้ตามเดิม — อยากตั้งเองต่อบัญชีได้ ไม่อยากให้ตายตัวในโค้ด
--
-- ค่า default มาจาก MATCH_CONCEPTS (built-in, lib/ledger/reconcile-match-keywords.ts) เป็นฐานทุกบัญชี
-- ตารางนี้เก็บเฉพาะค่าที่ "ตั้งเอง" ทับ default ต่อ (บัญชี, concept) — ไม่ตั้งแถว = ใช้ default เดิมทุกอย่าง
--   bank_account_id = NULL → org default (เผื่ออนาคต ยังไม่มี UI เขียนแถวนี้รอบนี้)
--   bank_account_id = ระบุ → เฉพาะบัญชีนั้น (เหมือนรูปแบบ ledger_bank_match_keyword)
-- date_window_days / tol_baht เป็น NULL อิสระต่อกัน — ตั้งแค่อันเดียวได้ อีกอันยัง fallback default
--   date_window_days = 0 → ต้องเป็นวันเดียวกันเป๊ะ (ตามที่ CEO ขอสำหรับ QR)
--   tol_baht ตั้งแล้ว → แทนที่ tolerance เดิมทั้งหมด (ไม่ผสมกับ % เดิม กันสับสน — ตั้งเป็นบาทตรงๆ ตามที่ CEO พูด)
--
-- additive · ไม่แตะ schema เดิม · Prisma bypass RLS → ทุก query self-scope org_id เอง.

CREATE TABLE IF NOT EXISTS public.ledger_bank_match_rule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  bank_account_id   uuid REFERENCES public.ledger_bank_account(id) ON DELETE CASCADE,
  concept_key       varchar(30) NOT NULL,    -- grab/shopee/lineman/card/qr/cash/other
  date_window_days  int,                     -- NULL = ใช้ default เดิม
  tol_baht          numeric(12,2),           -- NULL = ใช้ default เดิม
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- กันซ้ำ: 1 (บัญชี, concept) — NULL account ถือเป็น org-default ก้อนเดียว
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_rule_uniq
  ON public.ledger_bank_match_rule
     (org_id, COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid), concept_key);

-- lookup ตอน matcher โหลด (ต่อ org + บัญชี)
CREATE INDEX IF NOT EXISTS ledger_bank_match_rule_lookup_idx
  ON public.ledger_bank_match_rule (org_id, bank_account_id, concept_key);

ALTER TABLE public.ledger_bank_match_rule ENABLE ROW LEVEL SECURITY;
