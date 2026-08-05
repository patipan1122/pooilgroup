-- ClawFleet · "คลังหลักข้ามสาขา" (cross-branch main warehouse).
-- Additive only. Nullable column + self-FK. Zero change to existing on-hand math:
--   null = สาขาใช้คลังตัวเอง (พฤติกรรมเดิม 100%). ตั้งค่า = สาขานี้ดึง/คืนสต๊อกกับคลังของสาขาต้นทาง.
-- SAFETY: ON DELETE SET NULL → ลบสาขาต้นทาง = สาขาปลายทางกลับไปใช้คลังตัวเอง (ไม่ค้าง FK พัง).

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS stock_source_branch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_stock_source_branch_id_fkey'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_stock_source_branch_id_fkey
      FOREIGN KEY (stock_source_branch_id)
      REFERENCES public.branches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- reverse lookup: "สาขาไหนใช้ X เป็นคลังต้นทางบ้าง" (ใช้ตอน validate ห้ามตั้งคลังต้นทางซ้อน + ตอนลบ)
CREATE INDEX IF NOT EXISTS branches_stock_source_branch_id_idx
  ON public.branches (stock_source_branch_id);
