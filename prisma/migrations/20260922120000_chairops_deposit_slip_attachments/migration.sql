-- ChairOps · สลิปเสริมที่แนบเข้ากับรายการฝากเงินที่มีอยู่แล้ว
-- (CEO 2026-09-22 · แม่บ้านลืมแนบสลิปตอนฝาก ส่งมาทีหลังทาง LINE office แนบให้
--  ตามหลัง หรือฝากครั้งเดียวมีมากกว่า 1 สลิปจริง)
--
-- ADDITIVE · ตารางใหม่ทั้งหมด ไม่กระทบ ChairopsCashDeposit เดิม. สลิปหลักยังอยู่
-- ที่ slipPhotoUrl เหมือนเดิม (AI ตรวจสลิป/requiresReview ไม่แตะตารางนี้เลย) —
-- ตารางนี้เก็บเฉพาะสลิปเสริมที่แนบตามหลัง แนบได้ทันทีไม่ต้องขออนุมัติ.
CREATE TABLE IF NOT EXISTS chairops."ChairopsDepositSlipAttachment" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "orgId"        TEXT        NOT NULL,
  "depositId"    TEXT        NOT NULL,
  "url"          TEXT        NOT NULL,
  "note"         TEXT,
  "uploadedById" TEXT        NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChairopsDepositSlipAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChairopsDepositSlipAttachment_depositId_fkey"
    FOREIGN KEY ("depositId") REFERENCES chairops."ChairopsCashDeposit"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChairopsDepositSlipAttachment_depositId_idx"
  ON chairops."ChairopsDepositSlipAttachment" ("depositId");
CREATE INDEX IF NOT EXISTS "ChairopsDepositSlipAttachment_orgId_idx"
  ON chairops."ChairopsDepositSlipAttachment" ("orgId");
