-- ClawFleet · จัดเรียงลำดับตู้ต่อพนักงาน (per-user machine order) · CEO 2026-08-01
-- ADDITIVE ONLY: 1 ตารางใหม่ (display/preference) — ไม่แตะเงิน/ตารางเดิม → ปลอดภัยต่อระบบที่รันอยู่.
-- idempotent: IF NOT EXISTS ทุกจุด (รันซ้ำได้). standalone (ไม่มี FK) · save = เขียนทับทั้งชุดต่อ (org,user) กัน orphan.

CREATE TABLE IF NOT EXISTS public.cf_staff_machine_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  user_id     uuid NOT NULL,
  machine_id  uuid NOT NULL,
  sort_order  integer NOT NULL,
  updated_at  timestamptz(6) NOT NULL DEFAULT now()
);

-- 1 พนักงาน 1 ตู้ มีลำดับเดียว (upsert/rewrite ตาม key นี้)
CREATE UNIQUE INDEX IF NOT EXISTS cf_staff_machine_orders_org_user_machine_key
  ON public.cf_staff_machine_orders (org_id, user_id, machine_id);
-- โหลดลำดับของพนักงานคนหนึ่ง (ทุกตู้ที่จัดไว้)
CREATE INDEX IF NOT EXISTS cf_staff_machine_orders_org_user_idx
  ON public.cf_staff_machine_orders (org_id, user_id);
