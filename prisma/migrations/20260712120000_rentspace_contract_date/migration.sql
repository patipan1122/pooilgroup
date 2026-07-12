-- RentSpace · เพิ่มวันที่ "ทำสัญญา ณ วันที่" (contract_date) — รองรับคีย์สัญญาย้อนหลัง.
-- Additive · nullable · schema public. ปลอดภัยกับโค้ดเก่า (null = fallback createdAt).
ALTER TABLE public.rental_contract
  ADD COLUMN IF NOT EXISTS contract_date date;
