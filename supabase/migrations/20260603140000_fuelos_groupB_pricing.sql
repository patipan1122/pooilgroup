-- FuelOS bigfeature · GROUP B (pricing redesign)
-- 1) zone_margins.transport_cost — แยกค่าขนส่ง (คลัง→โซน) ออกจากกำไร (CEO ตัวเลือก A)
-- 2) fuel.depots — config คลัง (CEO มี 5 คลัง) · seed จาก depot_prices เดิม

ALTER TABLE fuel.zone_margins ADD COLUMN IF NOT EXISTS transport_cost numeric(10,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fuel.depots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  name       text NOT NULL,
  sort       int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS depots_org_name_key ON fuel.depots (org_id, name);
CREATE INDEX IF NOT EXISTS depots_org_active_idx ON fuel.depots (org_id, is_active);

-- seed: คลังที่เคยมีใน depot_prices (ของเดิมจะ map ได้) · CEO เพิ่มที่เหลือผ่าน UI
INSERT INTO fuel.depots (org_id, name, sort)
SELECT DISTINCT dp.org_id, dp.depot_name, 0
FROM fuel.depot_prices dp
WHERE dp.depot_name IS NOT NULL AND dp.depot_name <> ''
ON CONFLICT (org_id, name) DO NOTHING;
