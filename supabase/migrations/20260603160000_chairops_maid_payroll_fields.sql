-- =============================================================
-- ChairOps · Maid payroll/HR fields (CEO 2026-06-03)
-- =============================================================
-- Adds bank-account + employment-contract attachment columns to
-- chairops."ChairopsUser" so maid records carry enough to set up payroll
-- later (เบอร์โทร already exists as "phone"). All nullable + idempotent —
-- safe to re-run, no backfill needed.
--
--   bankName          ธนาคาร (e.g. "กสิกรไทย")
--   bankAccountNo     เลขบัญชี
--   bankAccountName   ชื่อบัญชี (may differ from displayName)
--   contractFileUrl   R2 (later: Google Drive) link to สัญญาจ้าง
--   contractFileName  original filename for display
-- =============================================================

ALTER TABLE chairops."ChairopsUser"
  ADD COLUMN IF NOT EXISTS "bankName"         text,
  ADD COLUMN IF NOT EXISTS "bankAccountNo"    text,
  ADD COLUMN IF NOT EXISTS "bankAccountName"  text,
  ADD COLUMN IF NOT EXISTS "contractFileUrl"  text,
  ADD COLUMN IF NOT EXISTS "contractFileName" text;
