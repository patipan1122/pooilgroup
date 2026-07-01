-- ClawOS · audit wave B (2026-07-01) — ราคาสินค้าบนใบกระจาย (finding B4 + CEO rule)
-- Additive only · idempotent (ADD COLUMN IF NOT EXISTS) · apply to prod BEFORE deploy (schema-applied gate).
-- แอดมินส่วนกลางส่งของ → ต้องระบุ "ราคาขาย" + "ราคาทุน" ของสินค้า ณ ตอนส่ง (บันทึกบน cf_delivery_lines).
--   - sale_price_baht : ราคาขาย (บาท/ครั้ง) — ใช้เป็นราคาขายเริ่มต้นตอนสาขารับเข้า
--   - unit_cost_cents : ราคาทุน (สตางค์) — ใช้เป็นต้นทุนตอนสาขารับเข้าคลัง (weighted-avg)
-- แถวเก่า (ก่อน migration นี้) จะได้ sale_price_baht = NULL, unit_cost_cents = 0 (ยังคงยืนยันรับได้ด้วยต้นทุนเฉลี่ยเดิม).

ALTER TABLE public.cf_delivery_lines ADD COLUMN IF NOT EXISTS sale_price_baht integer;
ALTER TABLE public.cf_delivery_lines ADD COLUMN IF NOT EXISTS unit_cost_cents integer NOT NULL DEFAULT 0;
