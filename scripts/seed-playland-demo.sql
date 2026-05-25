-- Playland demo seed · idempotent · run with psql
-- Cleanup: DELETE FROM playland.family_groups WHERE display_name LIKE '%(demo)%' CASCADE works via FK

DO $$
DECLARE
  v_org_id uuid := COALESCE(NULLIF(current_setting('app.seed_org_id', true), '')::uuid, '00000000-0000-0000-0000-000000000001');
  v_branch_id uuid;
  v_device_id uuid;
  v_fg_id uuid;
  v_kid_id uuid;
  v_parent_id uuid;
BEGIN
  -- Branch
  INSERT INTO playland.branches (id, org_id, name, slug, address, phone, active, created_at, updated_at)
  VALUES (gen_random_uuid(), v_org_id, 'สาขา Demo', 'demo-branch', '123 ถนนทดสอบ', '021234567', true, now(), now())
  ON CONFLICT (slug) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_branch_id;

  -- Packages
  INSERT INTO playland.packages (id, org_id, branch_id, type, name, minutes, price, active, sort_order, created_at, updated_at) VALUES
    (gen_random_uuid(), v_org_id, v_branch_id, 'FIXED', '30 นาที', 30, 6000, true, 1, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'FIXED', '60 นาที', 60, 10000, true, 2, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'FIXED', '120 นาที', 120, 18000, true, 3, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'DAY_PASS', 'Day Pass ทั้งวัน', NULL, 25000, true, 4, now(), now())
  ON CONFLICT DO NOTHING;

  INSERT INTO playland.packages (id, org_id, branch_id, type, name, minutes, price, per_minute_rate, active, sort_order, created_at, updated_at)
  VALUES (gen_random_uuid(), v_org_id, v_branch_id, 'PER_MINUTE', 'Pay-per-minute', NULL, 200, 200, true, 5, now(), now())
  ON CONFLICT DO NOTHING;

  -- Products
  INSERT INTO playland.products (id, org_id, branch_id, name, barcode, category, price_cents, stock, reorder_level, active, sort_order, created_at, updated_at) VALUES
    (gen_random_uuid(), v_org_id, v_branch_id, 'น้ำเปล่า 600ml',   '8851111111111', 'เครื่องดื่ม', 1500, 50, 10, true, 1, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'น้ำอัดลม 325ml',   '8851111222222', 'เครื่องดื่ม', 2000, 30, 10, true, 2, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'ขนมโอริโอ้',       '8851111333333', 'ขนม',        3500, 20,  5, true, 3, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'ปาท่องโก๋',         '8851111444444', 'ขนม',        2500, 15,  5, true, 4, now(), now()),
    (gen_random_uuid(), v_org_id, v_branch_id, 'ของเล่นสุ่ม',       '8851111555555', 'ของเล่น',     9900, 10,  3, true, 5, now(), now())
  ON CONFLICT (branch_id, barcode) DO NOTHING;

  -- Device (mock vendor — works without real hardware)
  INSERT INTO playland.devices (id, org_id, branch_id, vendor, model, device_id, device_name, protocol, "modelVersion", webhook_secret, status, created_at, updated_at)
  VALUES (gen_random_uuid(), v_org_id, v_branch_id, 'mock', 'ACS-F606', 'MOCK-DEMO-001', 'ประตูหลัก (mock)', 'http', 'C', 'demo-secret-1234', 'ONLINE', now(), now())
  ON CONFLICT (device_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_device_id;

  -- Family + Members (only if no existing demo family — keeps it idempotent without weird state)
  IF NOT EXISTS (SELECT 1 FROM playland.family_groups WHERE org_id = v_org_id AND display_name LIKE '%(demo)%') THEN
    INSERT INTO playland.family_groups (id, org_id, branch_id, display_name, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, v_branch_id, 'ครอบครัวคุณสมศักดิ์ (demo)', now(), now())
    RETURNING id INTO v_fg_id;

    INSERT INTO playland.members (id, org_id, branch_id, type, name, nickname, phone, consent_at, retention_until, metadata, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, v_branch_id, 'KID', 'น้องมิว (demo)', 'มิว', '0810000001', now(), now() + interval '1 year', '{"demo":true}'::jsonb, now(), now())
    RETURNING id INTO v_kid_id;

    INSERT INTO playland.members (id, org_id, branch_id, type, name, phone, consent_at, retention_until, metadata, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, v_branch_id, 'PARENT', 'คุณสมศักดิ์ (demo)', '0810000002', now(), now() + interval '1 year', '{"demo":true}'::jsonb, now(), now())
    RETURNING id INTO v_parent_id;

    INSERT INTO playland.family_members (id, org_id, family_group_id, member_id, role, can_pick_up, added_at) VALUES
      (gen_random_uuid(), v_org_id, v_fg_id, v_kid_id, 'child', false, now()),
      (gen_random_uuid(), v_org_id, v_fg_id, v_parent_id, 'primary_guardian', true, now());
  END IF;

  RAISE NOTICE 'Seed complete — branch=%, device=%', v_branch_id, v_device_id;
END $$;
