-- DC Pinpoint 715efd92 — additive migration (CEO 2026-06-29)
--  1) สถานะใหม่ READY_TO_RECEIVE ("พร้อมรับเข้า") = จ่ายค่าขนส่ง+ของถึงโกดังแล้ว แต่ยังไม่นับเข้าสต๊อก (#6)
--  2) ตารางเรตค่าขนส่งต่อคิว (m³) แยกรถ/เรือ — คิดค่าขนส่งอัตโนมัติ (#4)
-- ปลอดภัย: ADD VALUE / CREATE TABLE IF NOT EXISTS — ไม่แตะข้อมูลเดิม · รันด้วย psql "$DIRECT_URL"

-- 1) enum value ใหม่ (idempotent)
ALTER TYPE dc."DcPoStatus" ADD VALUE IF NOT EXISTS 'READY_TO_RECEIVE';

-- 2) ตารางเรตค่าขนส่ง (id มาจากแอป — Prisma @default(uuid()) — DEFAULT เผื่อ insert มือ)
CREATE TABLE IF NOT EXISTS dc.freight_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  mode                dc."DcShipmentMode" NOT NULL,
  rate_per_cbm_satang integer NOT NULL DEFAULT 0,
  updated_by_user_id  uuid,
  updated_at          timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS freight_rates_org_mode_key
  ON dc.freight_rates (org_id, mode);
