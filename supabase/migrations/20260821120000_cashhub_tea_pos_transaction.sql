-- CashHub ร้านชาไข่มุก — รายบิลจาก Foodstory "แยกตามบิล" (2026-08-21)
-- เก็บไว้ทำหน้า "ไส้ใน" ต่อวัน/ช่องทาง (เช่น QR วันที่ 1 ส.ค. แตกเป็น ฿19/฿24/฿34 ฯลฯ)
-- CEO: เงินเข้าจริงเป็นรายทรานเซกชัน ไม่ใช่ยอดรวมก้อนเดียว — อยากเห็นไส้ในก่อนส่งแมตช์กับธนาคาร
--
-- เดิม tea-parse.ts อ่านรายบิลแล้วรวมยอดลง cashhub_tea_daily.pos_channels ทันที (ทิ้งรายบิล) —
-- พฤติกรรมเดิมคงไว้ไม่เปลี่ยน ตารางนี้เป็น "มุมมองเสริม" เก็บรายบิลเพิ่ม ไม่กระทบยอดที่ส่งเข้า reconcile
--
-- report_type: 'summary' = รายงาน "สรุปยอดขายแยกตามบิล" (1 แถว = 1 บิลจริง ตรงยอดโอนธนาคาร) ✅ เชื่อถือได้
--              'detail'  = รายงาน "แยกตามรายละเอียดบิล" (1 แถว = 1 รายการเมนูในบิล ⚠️ บิลเดียวอาจมีหลายแถว
--                          ยอดต่อแถวไม่ตรงยอดโอนจริงทีละรายการ — หน้าไส้ในต้องเตือนผู้ใช้เมื่อเจอ type นี้)
--
-- ไฟล์ Foodstory ต้นทางไม่มีเลขที่บิล/เวลา → ไม่มี unique key ระดับรายการ กันซ้ำด้วยการลบทั้งชุด
-- ของ (org, สาขา, วัน) แล้วเขียนใหม่ทุกครั้งที่อัปไฟล์ซ้ำวันเดิม (ทำใน data layer ไม่ใช่ DB constraint)

CREATE TABLE IF NOT EXISTS public.cashhub_tea_pos_transaction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  branch_code   varchar(24) NOT NULL,
  sales_date    date NOT NULL,
  channel_code  varchar(24) NOT NULL,        -- cash | qr | card | grab | lineman | shopee | wallet | discount | other
  amount_baht   numeric(12,2) NOT NULL,
  report_type   varchar(10) NOT NULL DEFAULT 'summary' CHECK (report_type IN ('summary','detail')),
  source_file   varchar(200),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- หน้าไส้ใน โหลดต่อ (org, สาขา, วัน, ช่องทาง)
CREATE INDEX IF NOT EXISTS cashhub_tea_pos_transaction_lookup_idx
  ON public.cashhub_tea_pos_transaction (org_id, branch_code, sales_date, channel_code);

ALTER TABLE public.cashhub_tea_pos_transaction ENABLE ROW LEVEL SECURITY;
-- เข้าถึงผ่าน service-role (adminClient) เท่านั้น เหมือนตาราง cashhub_tea อื่น — query scope org_id เสมอ
