-- ChairOps · อนุมัติ + ขอลบสลิปที่แนบเพิ่ม (CEO 2026-09-25)
--
-- ต่อจาก ChairopsDepositSlipAttachment (20260922120000) — พนักงานบางครั้งแนบ
-- สลิปผิดใบ ต้องแก้ได้จากหน้าเดียวกันโดยไม่ต้องไปหน้าอื่น:
--   1. "✓ อนุมัติ" — office ยืนยันว่าสลิปถูกต้อง กดได้ทันที ไม่ต้องรออนุมัติ
--   2. "ขอลบ" — maker/checker เหมือน ChairopsWriteOff: office ขอ + ใส่เหตุผล
--      บังคับ → MANAGER/CEO ขึ้นไปอนุมัติ/ปฏิเสธเท่านั้นถึงจะลบจริง (soft delete)
--
-- ADDITIVE เท่านั้น · เพิ่มคอลัมน์ nullable ทั้งหมดในตารางเดิม ไม่กระทบแถวที่มีอยู่
-- ไม่มี FK constraint ใหม่ (ตามคอนเวนชันเดิมของตารางนี้ — uploadedById ก็ไม่มี FK
-- เช่นกัน ชื่อผู้ทำรายการ resolve ผ่าน query layer แทน).
ALTER TABLE chairops."ChairopsDepositSlipAttachment"
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleteRequestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "deleteRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "deleteStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "deleteApproverById" TEXT,
  ADD COLUMN IF NOT EXISTS "deleteApproverAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleteApproverNote" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChairopsDepositSlipAttachment_orgId_deleteStatus_idx"
  ON chairops."ChairopsDepositSlipAttachment" ("orgId", "deleteStatus");
