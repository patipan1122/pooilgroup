-- RentSpace: วันที่บนใบกำกับภาษี = วันที่ลูกค้าชำระเงินงวดล่าสุด แทนวันที่กดปุ่มออกเลข (2026-08-17)
-- taxInvoiceIssuedAt เดิมยังอยู่เหมือนเดิม (audit: กดปุ่มตอนไหนจริง) — คอลัมน์นี้แยกไว้สำหรับพิมพ์เท่านั้น
ALTER TABLE "public"."rental_bill"
  ADD COLUMN IF NOT EXISTS "tax_invoice_date" date;
