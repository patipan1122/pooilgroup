-- RentSpace: ลำดับที่ CEO จัดเองในหน้า Excel matrix (แยกจาก sort_order ของหน้าห้อง/ยูนิต)
-- null = ห้องนั้นยังไม่ถูกจัด → fallback เรียงตาม sort_order, code เหมือนเดิม
-- display-only · ไม่แตะยอดเงิน/บิลใด ๆ
ALTER TABLE "public"."rental_unit"
  ADD COLUMN IF NOT EXISTS "matrix_sort_order" integer;
