-- DC · ใบสั่งซื้อ: เพิ่มการจ่ายเงินแบบ "รวมหลายใบจ่ายทีเดียว" (#13)
-- payment ทุกแถวที่จ่ายในรอบเดียวกันจะถูกแสตมป์ batch_id เดียวกัน
-- additive · idempotent · dc schema เท่านั้น (กัน migrate-diff drift ข้ามสคีมา)
ALTER TABLE "dc"."po_payments" ADD COLUMN IF NOT EXISTS "batch_id" uuid;
CREATE INDEX IF NOT EXISTS "po_payments_org_batch_idx" ON "dc"."po_payments" ("org_id", "batch_id");
