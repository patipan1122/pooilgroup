-- CashHub 🧋 ร้านชาไข่มุก — สะพานเชื่อม reconcile: เปิดให้ส่งยอดเข้าจริง → ledger_revenue_entry
-- (CEO 2026-06-18). ADDITIVE ONLY — แค่ขยาย source_type CHECK ให้รับ 'CASHHUB_TEA'
-- (เติมจากชุดเดิม + CASHHUB_AMAZON + CASHHUB_HOTEL + CASHHUB_FUEL). ค่าเดิมยังใช้ได้ทุกตัว.
-- ไม่มีตารางใหม่: config เก็บใน cashhub_tea_channel_config (มีแล้ว) · book entry ลง
-- ledger_revenue_entry (มีแล้ว). ปลอดภัยรันซ้ำ (idempotent).

ALTER TABLE public.ledger_revenue_entry
  DROP CONSTRAINT IF EXISTS ledger_revenue_entry_source_type_check;
ALTER TABLE public.ledger_revenue_entry
  ADD CONSTRAINT ledger_revenue_entry_source_type_check
  CHECK (source_type IN (
    'TRCLOUD_IV','CHAIROPS','CLAWFLEET','FUELOS','WEBHOOK','MANUAL',
    'CASHHUB_AMAZON','CASHHUB_HOTEL','CASHHUB_FUEL','CASHHUB_TEA'
  ));
