-- ClawOS · ultrareview Wave 3 — มอบหมายตู้ให้พนักงานเก็บ (route assignment · 2026-07-02)
-- Additive · idempotent. รันบน Supabase ด้วย psql DIRECT_URL ก่อน deploy code (schema-gate).
-- opt-in: null = พฤติกรรมเดิม (ทุกคนในสาขาเก็บได้) · มีค่า = แอปมือถือกรองเหลือ "ตู้ของฉัน" (แก้ collector เห็นตู้ปนสาขา)

ALTER TABLE public.cf_machines ADD COLUMN IF NOT EXISTS assigned_staff_id uuid;
CREATE INDEX IF NOT EXISTS cf_machines_org_assigned_idx ON public.cf_machines (org_id, assigned_staff_id);
