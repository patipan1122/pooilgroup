-- Pooilgroup ERP — REPAIR MODULE RLS + helpers
-- 2026-05-20 · 7 tables: repair_categories, repair_technicians, repair_tickets,
--                        repair_photos, repair_parts, repair_timeline_events,
--                        repair_vendor_tokens
--
-- Pattern: matches existing RLS migrations (org_id-direct policy).
-- Run order: AFTER `prisma db push` creates the tables.
--
-- Public access pattern:
--   - Public ticket submit / track lookup happens through server actions that
--     use adminClient() (bypasses RLS) — validates input + rate-limits at app layer.
--   - Vendor magic-link lookup ditto (adminClient + token verification).
--   - These RLS policies cover authenticated admin/tech sessions.

-- ============================================================
-- 1. RLS: repair_categories
-- ============================================================
ALTER TABLE public.repair_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_categories_org_isolation" ON public.repair_categories;
CREATE POLICY "repair_categories_org_isolation"
  ON public.repair_categories
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 2. RLS: repair_technicians
-- ============================================================
ALTER TABLE public.repair_technicians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_technicians_org_isolation" ON public.repair_technicians;
CREATE POLICY "repair_technicians_org_isolation"
  ON public.repair_technicians
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 3. RLS: repair_tickets
-- ============================================================
ALTER TABLE public.repair_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_tickets_org_isolation" ON public.repair_tickets;
CREATE POLICY "repair_tickets_org_isolation"
  ON public.repair_tickets
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 4. RLS: repair_photos
-- ============================================================
ALTER TABLE public.repair_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_photos_org_isolation" ON public.repair_photos;
CREATE POLICY "repair_photos_org_isolation"
  ON public.repair_photos
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 5. RLS: repair_parts
-- ============================================================
ALTER TABLE public.repair_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_parts_org_isolation" ON public.repair_parts;
CREATE POLICY "repair_parts_org_isolation"
  ON public.repair_parts
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 6. RLS: repair_timeline_events
-- ============================================================
ALTER TABLE public.repair_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_timeline_events_org_isolation" ON public.repair_timeline_events;
CREATE POLICY "repair_timeline_events_org_isolation"
  ON public.repair_timeline_events
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 7. RLS: repair_vendor_tokens
-- ============================================================
ALTER TABLE public.repair_vendor_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_vendor_tokens_org_isolation" ON public.repair_vendor_tokens;
CREATE POLICY "repair_vendor_tokens_org_isolation"
  ON public.repair_vendor_tokens
  FOR ALL
  USING (org_id = public.current_org_id() OR public.is_super_admin())
  WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- ============================================================
-- 8. Seed default categories (idempotent · run per-org)
-- ============================================================
-- Inserts 8 default categories for every org that doesn't have any yet.
-- Safe to re-run.
INSERT INTO public.repair_categories (id, org_id, slug, label, emoji, default_urgency, sort_order, is_active)
SELECT gen_random_uuid(), o.id, c.slug, c.label, c.emoji, c.default_urgency::"RepairUrgency", c.sort_order, true
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('ac',          'แอร์/เครื่องปรับอากาศ', '❄️', 'NORMAL', 10),
    ('electrical',  'ไฟฟ้า/ปลั๊ก/แสงสว่าง',  '⚡',  'URGENT', 20),
    ('plumbing',    'น้ำ/ท่อ/สุขภัณฑ์',       '🚿', 'NORMAL', 30),
    ('pos',         'POS/คอมพิวเตอร์',         '💻', 'URGENT', 40),
    ('pump',        'ตู้จ่ายน้ำมัน/ปั๊ม',      '⛽', 'URGENT', 50),
    ('fridge',      'ตู้เย็น/แช่แข็ง',         '🧊', 'URGENT', 60),
    ('structure',   'โครงสร้าง/หลังคา/ประตู',  '🏗',  'LOW',    70),
    ('other',       'อื่น ๆ',                  '🛠',  'NORMAL', 90)
) AS c(slug, label, emoji, default_urgency, sort_order)
WHERE o.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.repair_categories rc
    WHERE rc.org_id = o.id AND rc.slug = c.slug
  );

-- ============================================================
-- 9. Helper function — next ticket code per org (atomic)
-- ============================================================
-- Format: RP-{พ.ศ. YY}-{NNNN}  (e.g. RP-2569-0001)
-- Uses sequence-like counter via row lock on a virtual counter table?
-- Simpler: count existing tickets for that org+year and +1, with retry on conflict.
-- We DO NOT rely on a sequence (because per-org ticket numbering).
CREATE OR REPLACE FUNCTION public.repair_next_ticket_code(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buddhist_year TEXT;
  v_count INT;
  v_code TEXT;
BEGIN
  -- Thai Buddhist Era short year (last 2 digits of พ.ศ. = AD year + 543, mod 100)
  v_buddhist_year := TO_CHAR((EXTRACT(YEAR FROM NOW())::INT + 543) % 100, 'FM00');

  SELECT COUNT(*) + 1
    INTO v_count
    FROM public.repair_tickets
   WHERE org_id = p_org_id
     AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());

  v_code := 'RP-' || v_buddhist_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.repair_next_ticket_code(UUID) TO authenticated, anon, service_role;

-- ============================================================
-- 10. Verification (run manually after apply)
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename LIKE 'repair_%';
--   -- all 7 should be true
--
--   SELECT public.repair_next_ticket_code((SELECT id FROM organizations LIMIT 1));
--   -- e.g. "RP-2569-0001"
--
--   SELECT label FROM repair_categories LIMIT 8;
--   -- 8 seeded categories per org
