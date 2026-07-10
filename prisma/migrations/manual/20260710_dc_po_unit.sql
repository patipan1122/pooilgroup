-- ADDITIVE · DC "จัดการสต๊อกเป็นใบ PO" (โอน/เบิก อ้างใบ PO + ค่าขนส่งไทย-ไทยบนใบโอน)
-- ปลอดภัย: เพิ่มคอลัมน์ nullable / มี DEFAULT เท่านั้น · ไม่แตะข้อมูลเดิม · idempotent (IF NOT EXISTS)
-- poId = documentary link (ไม่ใช่ physical lot) → ใช้คำนวณ "เหลือในใบ PO" = รับเข้า − โอน/เบิกที่ tag ใบนี้
-- thai_freight_satang = ค่าขนส่งไทย-ไทยของใบโอน · บันทึกเป็นค่าใช้จ่าย (ไม่บวกเข้า cost layer/ต้นทุนสินค้า)

-- ใบโอน (transfers)
ALTER TABLE dc.transfers ADD COLUMN IF NOT EXISTS po_id uuid;
ALTER TABLE dc.transfers ADD COLUMN IF NOT EXISTS thai_freight_satang integer NOT NULL DEFAULT 0;
ALTER TABLE dc.transfers ADD COLUMN IF NOT EXISTS thai_freight_note text;
CREATE INDEX IF NOT EXISTS transfers_org_po_idx ON dc.transfers (org_id, po_id);

-- ใบเบิก (issues)
ALTER TABLE dc.issues ADD COLUMN IF NOT EXISTS po_id uuid;
CREATE INDEX IF NOT EXISTS issues_org_po_idx ON dc.issues (org_id, po_id);
