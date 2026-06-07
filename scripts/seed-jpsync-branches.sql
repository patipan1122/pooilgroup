-- Seed JP Sync branches with full names + TRCloud project/department mapping
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to re-run: uses ON CONFLICT (org_id, code) DO UPDATE

DO $$
DECLARE
  v_org_id   UUID;
  v_comp_id  UUID;
  dept       TEXT := 'JPS_00001'; -- TRCloud department (นิติบุคคล JP Sync)
BEGIN
  -- Find JP Sync company
  SELECT org_id, id INTO v_org_id, v_comp_id
  FROM companies WHERE code = 'JPSYNC' LIMIT 1;

  IF v_comp_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบบริษัท JPSYNC — รันบน database ที่ถูกต้อง';
  END IF;

  RAISE NOTICE 'JP Sync: org_id=% company_id=%', v_org_id, v_comp_id;

  -- ── CAFE AMAZON ──────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'AMAZON-001', 'CAFE AMAZON สาขาเทศบาลจักราช',   'cafe', jsonb_build_object('trcloudProject', 'AMAZON-001-สาขาเทศบาลจักราช',   'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'AMAZON-002', 'CAFE AMAZON สาขาชุมชนหัวทะเล',   'cafe', jsonb_build_object('trcloudProject', 'AMAZON-002 สาขาชุมชนหัวทะเล',   'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── พันธุ์ไทย ─────────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'PUNTHAI-001', 'พันธุ์ไทย สาขาโคกสูง 2', 'cafe_punthai', jsonb_build_object('trcloudProject', 'PUNTHAI-001-สาขาโคกสูง 2', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── SNOWDIP ───────────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'SNOWDIP-001', 'SNOWDIP สาขา ปตท.แคนดง',   'cafe', jsonb_build_object('trcloudProject', 'SNOWDIP-001-สาขาปตท.แคนดง',   'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'SNOWDIP-002', 'SNOWDIP สาขา ปตท.ตลาดแค',  'cafe', jsonb_build_object('trcloudProject', 'SNOWDIP-002-สาขาปตท.ตลาดแค',  'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── Swensen's ─────────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'SWEN-001', 'Swensens สาขา ปตท.โนนคอย จักราช', 'cafe', jsonb_build_object('trcloudProject', 'Swen-001-สาขาปตท.โนนคอย จักราช', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── OWL CHA ───────────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'OWLCHA-001', 'OWL CHA สาขา ปตท.โนนคอย',        'cafe', jsonb_build_object('trcloudProject', 'OWLCHA-001 ปตท.โนนคอย',        'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'OWLCHA-002', 'OWL CHA สาขา ปตท.ชุมพวง',        'cafe', jsonb_build_object('trcloudProject', 'OWLCHA-002 ปตท.ชุมพวง',        'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'OWLCHA-003', 'OWL CHA สาขา ปตท.พิมาย',         'cafe', jsonb_build_object('trcloudProject', 'OWLCHA-003 ปตท.พิมาย',         'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'OWLCHA-004', 'OWL CHA สาขา ปตท.ลำทะเมนชัย',   'cafe', jsonb_build_object('trcloudProject', 'OWLCHA-004 ปตท.ลำทะเมนชัย',   'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'OWLCHA-005', 'OWL CHA สาขา ปตท.รังกาใหญ่',    'cafe', jsonb_build_object('trcloudProject', 'OWLCHA-005 ปตท.รังกาใหญ่',    'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── MR.WOOF ───────────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'MRWOOF-001', 'MR.WOOF สาขา ปตท.โนนแดง', 'cafe', jsonb_build_object('trcloudProject', 'MRWOOF-001-สาขาปตท.โนนแดง', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── ตู้คีบ DOLL ───────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-000', 'ตู้คีบ DOLL สาขา ปตท.ชุมพวง',      'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-000 ปตท.ชุมพวง',      'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-001', 'ตู้คีบ DOLL สาขา ปตท.แคนดง',      'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-001 ปตท.แคนดง',      'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-002', 'ตู้คีบ DOLL สาขา ปตท.ลำทะเมนชัย', 'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-002 ปตท.ลำทะเมนชัย', 'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-003', 'ตู้คีบ DOLL สาขา ปตท.โนนคอย',     'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-003 ปตท.โนนคอย',     'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-004', 'ตู้คีบ DOLL สาขา ปตท.โนนแดง',     'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-004 ปตท.โนนแดง',     'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-005', 'ตู้คีบ DOLL สาขา ปตท.เมืองยาง',   'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-005 ปตท.เมืองยาง',   'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-006', 'ตู้คีบ DOLL สาขา ปตท.ประทาย',     'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-006 ปตท.ประทาย',     'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-008', 'ตู้คีบ DOLL เก็บรายวัน',           'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-008 เก็บรายวัน',           'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-009', 'ตู้คีบ DOLL ต่างอำเภอ',            'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-009 ต่างอำเภอ',            'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'DOLL-010', 'ตู้คีบ DOLL รายสัปดาห์',           'claw_machine', jsonb_build_object('trcloudProject', 'DOLL-010 รายสัปดาห์',           'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── โรงแรม MIX ───────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'HOTEL-001', 'โรงแรม MIX', 'hotel', jsonb_build_object('trcloudProject', 'Hotel_001-โรงแรม MIX', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── เก้าอี้นวด ───────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'MASSAGE-001', 'เก้าอี้นวดไฟฟ้า', 'massage_chair', jsonb_build_object('trcloudProject', 'Massage Chair', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── ลูกชิ้นไจ้แอน ────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'JAIAN-001', 'ลูกชิ้นไจ้แอน สาขาจักราช',  'cafe', jsonb_build_object('trcloudProject', 'ลูกชิ้นไจ้แอน-จักราช',  'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'JAIAN-002', 'ลูกชิ้นไจ้แอน สาขาชุมพวง',  'cafe', jsonb_build_object('trcloudProject', 'ลูกชิ้นไจ้แอน-ชุมพวง',  'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'JAIAN-003', 'ลูกชิ้นไจ้แอน สาขาตลาดแค 1','cafe', jsonb_build_object('trcloudProject', 'ลูกชิ้นไจ้แอน-ตลาดแค1', 'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'JAIAN-004', 'ลูกชิ้นไจ้แอน สาขาตลาดแค 2','cafe', jsonb_build_object('trcloudProject', 'ลูกชิ้นไจ้แอน-ตลาดแค2', 'trcloudDepartment', dept), true, now(), now()),
    (gen_random_uuid(), v_org_id, v_comp_id, 'JAIAN-005', 'ลูกชิ้นไจ้แอน สาขาโนนแดง',  'cafe', jsonb_build_object('trcloudProject', 'ลูกชิ้นไจ้แอน-โนนแดง',  'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── 62 STATION ───────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, '62STN-001', '62 STATION สาขาหลังโลตัสหัวทะเล', 'fuel_station', jsonb_build_object('trcloudProject', '62 STATION-001-สาขาหลังโลตัสหัวทะเล', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  -- ── พื้นที่ให้เช่า ────────────────────────────────────────────────────────
  INSERT INTO branches (id, org_id, company_id, code, name, business_type, settings, is_active, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_org_id, v_comp_id, 'RENTAL-001', 'พื้นที่ให้เช่า ข้างปั๊ม 62', 'convenience_store', jsonb_build_object('trcloudProject', 'B-0001-พื้นที่ให้เช่าข้างปั๊ม 62', 'trcloudDepartment', dept), true, now(), now())
  ON CONFLICT (org_id, code) DO UPDATE SET
    name         = EXCLUDED.name,
    business_type = EXCLUDED.business_type,
    settings     = branches.settings || EXCLUDED.settings,
    is_active    = true,
    updated_at   = now();

  RAISE NOTICE '✅ Done — upserted 31 branches for JP Sync';
END $$;

-- Verify
SELECT code, name,
       settings->>'trcloudProject'    AS trcloud_project,
       settings->>'trcloudDepartment' AS trcloud_dept
FROM branches
WHERE org_id = (SELECT org_id FROM companies WHERE code = 'JPSYNC' LIMIT 1)
ORDER BY business_type, code;
