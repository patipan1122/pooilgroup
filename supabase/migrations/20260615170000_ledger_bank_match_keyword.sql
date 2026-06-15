-- LedgerLine Bank Recon — สมุดจำคีย์เวิร์ด (keyword dictionary) ต่อบัญชี (2026-06-15)
--
-- หลักการ (CEO): "ตั้งชื่อ 2 ฝั่งให้ตรงกัน" — ฝั่งบัญชีมี payment_channel (Grab/Shopee/EDC/QR/เงินสด)
-- ฝั่งธนาคารมีชื่อคู่ค้าใน ref2/description. การจับคู่ map ทั้งสองเข้า "concept" เดียวกัน.
--
-- keyword ในระบบ (Grab→"แกร็บ", Shopee→"ช้อปปี้เพย์", ...) เป็น built-in อยู่ในโค้ด
-- (lib/ledger/reconcile-match-keywords.ts MATCH_CONCEPTS) = seed เริ่มต้นทุกบัญชี.
-- ตารางนี้เก็บเฉพาะ "คีย์ที่เพิ่มเอง/เรียนรู้" ต่อบัญชี → matcher เอามาต่อท้าย built-in.
--   bank_account_id = NULL → ใช้ได้ทุกบัญชี (org default)
--   bank_account_id = ระบุ → เฉพาะบัญชีนั้น (CEO: "สมุดจำคีย์ 1 หน้า ต่อ 1 บัญชี")
-- source: seed=ติดมากับระบบ · learned=ระบบจำตอนคนยืนยันแมตช์ · manual=คนเพิ่มเอง
--
-- additive · ไม่แตะ schema เดิม · Prisma bypass RLS → ทุก query self-scope org_id เอง.

CREATE TABLE IF NOT EXISTS public.ledger_bank_match_keyword (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  bank_account_id uuid REFERENCES public.ledger_bank_account(id) ON DELETE CASCADE,  -- NULL = org default ทุกบัญชี
  concept_key     varchar(30)  NOT NULL,    -- grab/shopee/lineman/card/qr/cash/...
  keyword         varchar(120) NOT NULL,    -- คำหลัก (จะ lower + ค้นแบบ contains ใน ref2/description)
  source          varchar(12)  NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('seed','learned','manual')),
  confirmed_count int          NOT NULL DEFAULT 0,   -- ยืนยันด้วยคีย์นี้กี่ครั้ง (learned → ++)
  is_active       boolean      NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- กันซ้ำ: 1 (บัญชี, concept, คีย์) — NULL account ถือเป็น org-default ก้อนเดียว
CREATE UNIQUE INDEX IF NOT EXISTS ledger_bank_match_keyword_uniq
  ON public.ledger_bank_match_keyword
     (org_id, COALESCE(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid), concept_key, lower(keyword));

-- lookup ตอน matcher โหลด (ต่อ org + บัญชี)
CREATE INDEX IF NOT EXISTS ledger_bank_match_keyword_lookup_idx
  ON public.ledger_bank_match_keyword (org_id, bank_account_id, concept_key)
  WHERE is_active;

-- Prisma (postgres role) bypass RLS · เปิด RLS ไว้กัน role อื่น (anon/authenticated) เข้าถึงตรง
ALTER TABLE public.ledger_bank_match_keyword ENABLE ROW LEVEL SECURITY;
