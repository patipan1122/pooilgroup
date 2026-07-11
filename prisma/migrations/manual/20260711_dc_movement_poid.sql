-- Pinpoint #2 · โอน/เบิกจาก "หลายใบ PO" พร้อมกัน (money-safe · additive + backfill · ไม่มี data loss)
--
-- โมเดล: tag movement source-outbound (ISSUE/TRANSFER_OUT) + reversal (RETURN_IN) ต่อ "ใบ PO" ราย movement
--   → getPoFulfillment นับ movedOut ต่อใบแบบ NET (out −|qty|, reversal +|qty| → ใบยกเลิก/ลบ = 0 อัตโนมัติ).
-- ★ ตั้ง po_id เฉพาะ source-out + reversal เท่านั้น · ห้ามตั้งบน TRANSFER_IN ปลายทาง (refType='dc_transfer' เหมือนกัน) → กันปน.
-- ★ doc ที่ถูกลบ (row หาย) → backfill หา doc ไม่เจอ → po_id ทั้ง out+reversal = NULL → ตกจาก movedOut ทั้งคู่ = net 0 (ถูก).

-- 1) columns (nullable · idempotent)
ALTER TABLE dc.stock_movements ADD COLUMN IF NOT EXISTS po_id uuid NULL;
ALTER TABLE dc.transfer_lines  ADD COLUMN IF NOT EXISTS po_id uuid NULL;

-- 2) backfill source-out จาก header เดิม (เฉพาะ doc ที่ยังมี row) — เฉพาะ kind source-out
UPDATE dc.stock_movements m SET po_id = i.po_id
  FROM dc.issues i
  WHERE m.ref_type = 'dc_issue' AND m.kind = 'ISSUE'
    AND m.ref_id = i.id AND i.po_id IS NOT NULL AND m.po_id IS NULL;

UPDATE dc.stock_movements m SET po_id = t.po_id
  FROM dc.transfers t
  WHERE m.ref_type = 'dc_transfer' AND m.kind = 'TRANSFER_OUT'
    AND m.ref_id = t.id AND t.po_id IS NOT NULL AND m.po_id IS NULL;

-- 3) backfill reversal ของใบที่ "ยกเลิก" (doc row ยังอยู่ · RETURN_IN refType='dc_transfer_cancel') → net = 0
UPDATE dc.stock_movements m SET po_id = t.po_id
  FROM dc.transfers t
  WHERE m.ref_type = 'dc_transfer_cancel'
    AND m.ref_id = t.id AND t.po_id IS NOT NULL AND m.po_id IS NULL;

-- 4) backfill transfer_lines.po_id จาก header เดิม (แสดงต่อบรรทัด + ใช้ตอน cancel)
UPDATE dc.transfer_lines tl SET po_id = t.po_id
  FROM dc.transfers t WHERE tl.transfer_id = t.id AND t.po_id IS NOT NULL AND tl.po_id IS NULL;

-- 5) index สำหรับ getPoFulfillment (partial · เฉพาะที่มี po_id)
CREATE INDEX IF NOT EXISTS stock_movements_org_po_idx ON dc.stock_movements (org_id, po_id) WHERE po_id IS NOT NULL;
