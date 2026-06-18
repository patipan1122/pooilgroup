-- RentSpace · Pinpoint batch (2026-06-18)
-- เพิ่มคอลัมน์ล้วน ๆ (additive) — ปลอดภัย ของเก่า/โค้ดเก่าไม่กระทบ
-- ครอบคลุม: #3 ส่วนลดโปรฯ · #9c วันวางบิลต่อสัญญา · #7 วันย้ายออก · #5 ยกเลิกบิลแบบขออนุมัติ

-- สัญญา: ส่วนลดส่งเสริมการขาย + วันวางบิลเฉพาะเจ้า + วันย้ายออก
ALTER TABLE public.rental_contract
  ADD COLUMN IF NOT EXISTS promo_discount_thb numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_months       integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_start_period text,
  ADD COLUMN IF NOT EXISTS bill_issue_day     integer,
  ADD COLUMN IF NOT EXISTS move_out_date      date;

-- บิล: การยกเลิกแบบขออนุมัติ (maker≠checker) + log
ALTER TABLE public.rental_bill
  ADD COLUMN IF NOT EXISTS void_status        text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS void_reason        text,
  ADD COLUMN IF NOT EXISTS void_requested_by  uuid,
  ADD COLUMN IF NOT EXISTS void_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS void_decided_by    uuid,
  ADD COLUMN IF NOT EXISTS void_decided_at    timestamptz,
  ADD COLUMN IF NOT EXISTS void_decision_note text;
