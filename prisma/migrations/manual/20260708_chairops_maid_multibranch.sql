-- ChairOps · แม่บ้านหลายสาขา (CEO 2026-07-08)
-- ให้แม่บ้าน 1 คนผูกได้หลายสาขาพร้อมกัน (many-to-many ผ่าน ChairopsMaidAssignment)
-- Self-healing + idempotent · ปลอดภัย: ไม่แตะ cash records · ไม่ลบข้อมูล (แค่ปิด dup + เติม assignment ที่ขาด)
-- รันด้วย: psql "$DIRECT_URL" -f prisma/migrations/manual/20260708_chairops_maid_multibranch.sql
--
-- ลำดับ (ในทรานแซกชันเดียว):
--   1a. de-dup active (userId,branchId) ที่ซ้ำ — เก็บอันแรกสุด (startedAt,id) ที่เหลือปิด
--   1b. backfill — แม่บ้านที่มี primaryBranchId แต่ยังไม่มี active assignment ของสาขานั้น → เติมให้
--   1c. drop index เดิม "1 active ต่อแม่บ้าน" ถ้ามี (auto-detect ชื่อจาก def · no-op ถ้าไม่มี)
--   1d. assert — ต้องไม่มี active dup (userId,branchId) เหลือ ก่อนสร้าง unique ใหม่
--   1e. สร้าง unique ใหม่ (userId,branchId) — กันผูกสาขาเดิมซ้ำ (idempotency ของ addMaidBranch)

BEGIN;

-- 1a. de-dup active assignments ที่ซ้ำ (userId,branchId)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "userId", "branchId"
           ORDER BY "startedAt" ASC, id ASC
         ) AS rn
  FROM chairops."ChairopsMaidAssignment"
  WHERE "isActive" AND "endedAt" IS NULL
)
UPDATE chairops."ChairopsMaidAssignment" a
SET "isActive" = false, "endedAt" = now()
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 1b. backfill สาขาหลักที่ยังไม่มี active assignment
INSERT INTO chairops."ChairopsMaidAssignment"
  (id, "orgId", "userId", "branchId", "startedAt", "endedAt", "isActive")
SELECT gen_random_uuid(), u."orgId", u.id, u."primaryBranchId", now(), NULL, true
FROM chairops."ChairopsUser" u
WHERE u.role = 'MAID'
  AND u."primaryBranchId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chairops."ChairopsMaidAssignment" a
    WHERE a."userId" = u.id
      AND a."branchId" = u."primaryBranchId"
      AND a."isActive" AND a."endedAt" IS NULL
  );

-- 1c. drop index เดิม "1 active ต่อแม่บ้าน" ((userId) WHERE endedAt IS NULL AND isActive)
--     ตรวจจากนิยาม: UNIQUE + partial (WHERE) + อ้าง "userId" + ไม่อ้าง "branchId"
DO $$
DECLARE idx text;
BEGIN
  FOR idx IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'chairops'
      AND tablename = 'ChairopsMaidAssignment'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%WHERE%'
      AND indexdef ILIKE '%"userId"%'
      AND indexdef NOT ILIKE '%"branchId"%'
  LOOP
    EXECUTE format('DROP INDEX chairops.%I', idx);
    RAISE NOTICE 'dropped old 1-active-per-maid index: %', idx;
  END LOOP;
END $$;

-- 1d. assert ต้องไม่มี active dup (userId,branchId) เหลือ
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT "userId", "branchId"
    FROM chairops."ChairopsMaidAssignment"
    WHERE "isActive" AND "endedAt" IS NULL
    GROUP BY "userId", "branchId"
    HAVING count(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'ยังมี active assignment ซ้ำ (userId,branchId) % คู่ — หยุด migration', dup_count;
  END IF;
END $$;

-- 1e. unique ใหม่ · 1 active ต่อ (แม่บ้าน,สาขา) — อนุญาตหลายสาขาต่อแม่บ้าน แต่กันสาขาซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS "ChairopsMaidAssignment_userId_branchId_active_key"
  ON chairops."ChairopsMaidAssignment" ("userId", "branchId")
  WHERE "isActive" AND "endedAt" IS NULL;

COMMIT;
