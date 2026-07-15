-- ClawFleet · ราคาขายตุ๊กตา "ต่อตู้" (ราคาเดียวต่อตู้ · เก็บเป็นบาท×100)
-- ตั้งตอน "ตั้งค่าครั้งแรก" · เป็นค่าอ้างอิง/แสดงผล (ดูมาร์จิ้นเทียบราคาทุน) — ไม่แตะการกระทบยอดเงินจริง.
-- nullable · forward-only · ตู้เดิมที่ยังไม่ตั้ง = NULL (แอปโชว์ "ยังไม่ตั้งราคา").
ALTER TABLE "public"."cf_machines" ADD COLUMN IF NOT EXISTS "sell_price_cents" INTEGER;
