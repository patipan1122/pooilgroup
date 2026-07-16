-- ClawFleet · ใบรับสินค้าเป็น "เอกสารจริง" (CEO 2026-07-16 · doc-first receive)
-- ผูกใบรับ (cf_goods_receipts) กลับไปหาเอกสารต้นทาง: ใบโอน DC ('dc_transfers') หรือใบกระจาย ('cf_deliveries').
-- nullable · additive · forward-only — ใบรับ manual เดิม (รับเข้าตรง) ref เป็น NULL ไม่กระทบ.
ALTER TABLE "public"."cf_goods_receipts" ADD COLUMN IF NOT EXISTS "ref_table" TEXT;
ALTER TABLE "public"."cf_goods_receipts" ADD COLUMN IF NOT EXISTS "ref_id" UUID;

-- idempotency จริงระดับ DB: 1 เอกสารต้นทาง → 1 ใบรับ (Postgres NULL-distinct → แถว manual ที่ ref NULL ไม่ชนกัน)
CREATE UNIQUE INDEX IF NOT EXISTS "cf_goods_receipts_org_id_ref_table_ref_id_key"
  ON "public"."cf_goods_receipts"("org_id", "ref_table", "ref_id");
