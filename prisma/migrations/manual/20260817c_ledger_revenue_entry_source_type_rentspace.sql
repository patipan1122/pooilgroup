-- LedgerLine: อนุญาต source_type='RENTSPACE' บน ledger_revenue_entry (2026-08-17)
-- ตารางนี้ใช้ร่วมหลายโมดูล (ChairOps/ClawFleet/FuelOS/CashHub/...) — เติมค่าใหม่เข้า
-- CHECK เดิม ไม่ลบ/เปลี่ยนค่าเดิมสักตัว แถวเก่าทั้งหมดยังผ่านเงื่อนไขเดิมทุกประการ.
ALTER TABLE "public"."ledger_revenue_entry"
  DROP CONSTRAINT IF EXISTS "ledger_revenue_entry_source_type_check";
ALTER TABLE "public"."ledger_revenue_entry"
  ADD CONSTRAINT "ledger_revenue_entry_source_type_check"
  CHECK (source_type IN (
    'TRCLOUD_IV', 'CHAIROPS', 'CLAWFLEET', 'FUELOS', 'WEBHOOK', 'MANUAL',
    'CASHHUB_AMAZON', 'CASHHUB_HOTEL', 'CASHHUB_FUEL', 'CASHHUB_TEA', 'RENTSPACE'
  ));
