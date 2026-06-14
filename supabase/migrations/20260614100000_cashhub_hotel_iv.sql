-- CashHub Hotel — เชื่อม IV จาก TRCloud (ดึงยอดขาย+เลข IV เข้าราย วัน/กะ)
-- หน้างานคีย์ IV เข้า TRCloud แล้ว → ดึงมาเติม total_sales + เลข IV ไม่ต้องคีย์ Excel ซ้ำ
-- + ใช้ตรวจว่า IV ถูกคีย์ครบทุกวัน/กะไหม. ADDITIVE nullable.
-- ⚠️ ยังไม่ apply prod — รอ CEO อนุมัติขั้น "เขียนยอด IV เข้า Excel อัตโนมัติ".
ALTER TABLE public.cashhub_hotel_daily
  ADD COLUMN IF NOT EXISTS iv_number varchar(40),   -- เลขที่ IV TRCloud (traceability)
  ADD COLUMN IF NOT EXISTS iv_status varchar(20);    -- Debtor=ค้างจ่าย / Paid
