-- Playland: defer session timer start to actual gate-entry scan, not payment time.
-- CEO 2026-09-29: "เวลาต้องเริ่มรับตอนลูกค้าสแกนหน้าเข้า หรือ สแกนสายรัดข้อมือ" — paying at the
-- counter must not start the clock; only a real entry-scan (face or wristband) should.
ALTER TYPE "playland"."PlaylandSessionStatus" ADD VALUE IF NOT EXISTS 'PENDING_ENTRY' BEFORE 'ACTIVE';
