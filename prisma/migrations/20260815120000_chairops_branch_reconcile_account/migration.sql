-- ChairOps · หน้าตรวจยอด: ตั้งค่าบริษัท/บัญชีธนาคารหลักของสาขา
-- (CEO 2026-08-15 · ปุ่ม "ส่งเข้าบัญชี reconcile")
--
-- ใช้ตอนกด "ส่งฝากเข้าบัญชี reconcile" → เขียนลง ledger_revenue_entry
-- (source_type='CHAIROPS', เปิดสิทธิ์ไว้แล้วตั้งแต่ migration เดิม ไม่ต้องแก้
-- ledger เลย). ADDITIVE · nullable · ของเดิมไม่กระทบ.
ALTER TABLE chairops."ChairopsBranch"
  ADD COLUMN IF NOT EXISTS "reconcileCompanyId" UUID,
  ADD COLUMN IF NOT EXISTS "reconcileBankAccountId" UUID;
