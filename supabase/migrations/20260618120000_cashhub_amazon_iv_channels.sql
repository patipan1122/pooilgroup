-- CashHub Amazon — เก็บ "ไส้ใน" ของใบกำกับ TRCloud ราย-วัน เพื่อเทียบรายช่องทาง + VAT กับ POS
-- (มากับ response เดิม iv/search.php → special_note · ไม่เพิ่ม API call) · additive + nullable = ปลอดภัย
ALTER TABLE cashhub_amazon_daily
  ADD COLUMN IF NOT EXISTS iv_channels jsonb,          -- {"c1":4354,"c2":5623,...} ยอดรายช่องทางในใบจริง
  ADD COLUMN IF NOT EXISTS iv_pre_vat numeric(14,2);   -- ยอดก่อน VAT ในใบ (head.total) → vat_iv = iv_gross − iv_pre_vat
