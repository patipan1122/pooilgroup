-- RentSpace · ตารางอาคาร (เพื่อจัดการ/สร้าง/ลบ/เรียงอาคารเอง) — 2026-06-21
-- additive: ตารางใหม่ + คอลัมน์ใหม่ + backfill จากชื่ออาคารเดิม. ของเก่า (unit.building string) ยังอยู่ครบ.

CREATE TABLE IF NOT EXISTS public.rental_building (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.rental_project(id) ON DELETE CASCADE,
  name       text NOT NULL,
  zone       text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_building_org_project_idx ON public.rental_building (org_id, project_id, sort_order);

ALTER TABLE public.rental_unit ADD COLUMN IF NOT EXISTS building_id uuid;
CREATE INDEX IF NOT EXISTS rental_unit_building_idx ON public.rental_unit (building_id);

-- backfill: สร้างอาคารจากชื่ออาคารเดิมที่ไม่ว่าง (1 อาคารต่อชื่อต่อโครงการ)
INSERT INTO public.rental_building (org_id, project_id, name, sort_order)
SELECT DISTINCT u.org_id, u.project_id, btrim(u.building), 0
FROM public.rental_unit u
WHERE u.building IS NOT NULL AND btrim(u.building) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.rental_building b
    WHERE b.project_id = u.project_id AND b.name = btrim(u.building)
  );

-- ตั้งลำดับเริ่มต้นของอาคารตามชื่อ (A1, A2, A3 ...) สำหรับอาคารที่ยังเป็น 0
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY name) AS rn
  FROM public.rental_building
)
UPDATE public.rental_building b
SET sort_order = ordered.rn
FROM ordered
WHERE b.id = ordered.id AND b.sort_order = 0;

-- ผูกห้องเข้ากับอาคารตามชื่อ
UPDATE public.rental_unit u
SET building_id = b.id
FROM public.rental_building b
WHERE b.project_id = u.project_id
  AND b.name = btrim(u.building)
  AND u.building_id IS NULL;
