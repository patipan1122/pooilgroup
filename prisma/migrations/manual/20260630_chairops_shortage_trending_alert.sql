-- ChairOps · SHORTAGE_TRENDING alert kind (CEO 2026-06-29 · Wave 4)
-- เตือน "ยอดขาดสะสมโตต่อเนื่อง N รอบติด" (ระดับสาขา + ระดับเครื่อง · จากมิเตอร์ที่โกงไม่ได้)
-- Additive · idempotent · ปลอดภัย — ไม่แตะข้อมูลเดิม
-- รันด้วย: psql "$DIRECT_URL" -f prisma/migrations/manual/20260630_chairops_shortage_trending_alert.sql
-- NOTE: ALTER TYPE ADD VALUE ต้องอยู่นอก transaction block (psql รันเดี่ยว = autocommit)
ALTER TYPE "chairops"."ChairopsAlertKind" ADD VALUE IF NOT EXISTS 'SHORTAGE_TRENDING';
