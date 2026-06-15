-- CashHub — ตั้งค่า reconcile "แยกตามสาขา" (CEO 2026-06-15)
-- เดิม: 1 ค่าตั้ง/ช่องทาง/องค์กร (ใช้ทุกสาขาเหมือนกัน) → บางสาขาตั้งบัญชีไม่เหมือนกันทำไม่ได้
-- ใหม่: เพิ่มมิติ branch_code · '' (ค่าว่าง) = "ค่าเริ่มต้นทุกสาขา" (org default) · ค่าอื่น = override รายสาขา
--   เวลาส่งจริง: ใช้ค่าของสาขานั้นถ้ามี ไม่งั้น fallback ค่าเริ่มต้น ('')
-- ADDITIVE + BACKWARD-COMPATIBLE: แถวเดิม branch_code='' โดยอัตโนมัติ → กลายเป็นค่าเริ่มต้น พฤติกรรมเดิมไม่เปลี่ยน
--   (amazon=store_code · tea=branch_code · hotel=branch_id ของสาขา)
--
-- ⚠️ สำคัญ: ต้อง "ลบ unique เดิม (2 คอลัมน์)" ให้สำเร็จ ไม่งั้น row รายสาขาจะชนกับ unique เดิม
--   → ใช้ introspection ลบตามชุดคอลัมน์ (ไม่อิงชื่อ auto ที่อาจต่างข้าม env)

-- helper: ลบ unique constraint ใด ๆ ของตาราง ที่ครอบ "เฉพาะ" ชุดคอลัมน์ที่ระบุ (เป๊ะ)
CREATE OR REPLACE FUNCTION pg_temp.drop_unique_on(p_table regclass, p_cols text[])
RETURNS void AS $fn$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = p_table AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = p_table AND att.attnum = k.attnum
      ) = (SELECT array_agg(x ORDER BY x) FROM unnest(p_cols) AS x)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table::text, c.conname);
  END LOOP;
END;
$fn$ LANGUAGE plpgsql;

-- ── Amazon ──
ALTER TABLE public.cashhub_amazon_channel_config
  ADD COLUMN IF NOT EXISTS branch_code text NOT NULL DEFAULT '';
SELECT pg_temp.drop_unique_on('public.cashhub_amazon_channel_config', ARRAY['org_id','channel_cvar']);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cashhub_amazon_channel_config_org_branch_cvar_key') THEN
    ALTER TABLE public.cashhub_amazon_channel_config
      ADD CONSTRAINT cashhub_amazon_channel_config_org_branch_cvar_key
      UNIQUE (org_id, branch_code, channel_cvar);
  END IF;
END $$;

-- ── Tea ──
ALTER TABLE public.cashhub_tea_channel_config
  ADD COLUMN IF NOT EXISTS branch_code text NOT NULL DEFAULT '';
SELECT pg_temp.drop_unique_on('public.cashhub_tea_channel_config', ARRAY['org_id','channel_code']);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cashhub_tea_channel_config_org_branch_code_key') THEN
    ALTER TABLE public.cashhub_tea_channel_config
      ADD CONSTRAINT cashhub_tea_channel_config_org_branch_code_key
      UNIQUE (org_id, branch_code, channel_code);
  END IF;
END $$;

-- ── Hotel ── (branch_code เก็บ branch_id ของสาขาโรงแรม เป็น text)
ALTER TABLE public.cashhub_hotel_channel_config
  ADD COLUMN IF NOT EXISTS branch_code text NOT NULL DEFAULT '';
SELECT pg_temp.drop_unique_on('public.cashhub_hotel_channel_config', ARRAY['org_id','channel']);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cashhub_hotel_channel_config_org_branch_channel_key') THEN
    ALTER TABLE public.cashhub_hotel_channel_config
      ADD CONSTRAINT cashhub_hotel_channel_config_org_branch_channel_key
      UNIQUE (org_id, branch_code, channel);
  END IF;
END $$;
