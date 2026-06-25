# BugSolve · DC Warehouse (คลังกลาง) · 2026-06-25

> /bigsolvebug · fix-mode (discovery มาจาก /auditbigteam docs/AUDIT_dc.md · verified grep-backed) · mobile+desktop.
> ผลลัพธ์: 5 P0 + 11 P1 แก้ครบ · tsc clean · next build EXIT 0 · ไม่มี migration (code-only).

## §summary (Thai)
- **เงินปลอดภัยขึ้นจริง**: อุด 3 บั๊กเงิน/ของหาย — รับ PO ซ้ำ (ของ+ใบกำกับ TRCloud เด้งซ้ำ), ใบสั่งซื้อไทยคิดต้นทุนพอง ~5 เท่า, รับบางส่วนปิดใบทันที.
- **มือถือใช้ได้จริง**: ตารางหลังบ้านเลื่อนดูครบทุกคอลัมน์, แถบล่างเพิ่ม "เบิกออก", สแกนไม่เด้งคีย์บอร์ด, รับ/เบิก/โอน เน็ตหลุดไม่ลืมรายการ.
- **กันค้าง/กันเพี้ยน**: cron ตรวจของระหว่างทางรายวัน, กันยืนยันรับโอนซ้ำตอน race, กันแก้สถานะขนส่งถอยหลัง, TRCloud ส่งไม่เข้าขึ้นเตือน (ไม่หลอกว่าสำเร็จ).

## §scope
- Routes: app/(admin)/dc/** (floor + office · 29 หน้า) · lib/dc/*-actions.ts · components/dc/* · app/api/dc/reconcile
- Mode: Targeted-fix (ข้าม re-discovery — ใช้ผล audit ที่ verified แล้ว) · 4 fix-agent ขนาน (ไฟล์แยกกลุ่ม) + cron ทำเอง
- ไม่แตะ prisma/schema.prisma · ไม่ deploy โดยไม่อนุมัติ

## §bugs-fixed — P0 (5)
| # | ปัญหา | ที่ | วิธีแก้ |
|---|---|---|---|
| P0-1 | รับ PO ซ้ำ → ของ+TRCloud เด้งซ้ำ | po-actions.ts:758 · po-detail.tsx:714 | busy-lock ปุ่ม + receivePo re-read สถานะ: RECEIVED→idempotent no-op · ไม่อยู่ใน [ORDERED,SHIPPED,ARRIVED_TH,AT_WAREHOUSE,PARTIAL]→error |
| P0-2 | ใบสั่งซื้อไทยแปลงค่าเงินซ้ำ → ต้นทุนพอง ~5 เท่า | trcloud-bridge.ts:121 | po.origin===THAI หรือ currency===THB → บังคับ fxRate=1 (เหนือ shipment.fxRate/po.fxRate) |
| P0-3 | รับบางส่วนปิดใบเต็มทันที | po-actions.ts:824 | เทียบ Σรับสะสม(ทุก GRN) vs Σสั่ง → RECEIVED/PARTIAL · อนุญาต GRN ใบ 2 บน PARTIAL |
| P0-4 | ตารางหลังบ้านโดนตัดบนมือถือ (8 ไฟล์) | products/shipments/receipts/transfers/page + suppliers-manager + shipment-detail + grn-detail + transfer-confirm | inline overflow:hidden → overflowX:auto (ปลด .dc-card safety-net) |
| P0-5 | ไม่มี cron DC reconcile → ของระหว่างทางค้างถาวร | vercel.json + api/dc/reconcile/route.ts | cron รายวัน 45 20 * * * (03:45 ไทย) · route แก้ให้ cron วนทุก org ที่มีคลัง DC (ไม่ hardcode UUID) · 33/40 slot ไม่ชนโควต้า |

## §bugs-fixed — P1 (11)
- P1-1 เมนูเดสก์ท็อป + office hub เพิ่ม "การโอน" + "กระทบยอด" (modules.ts · office/page.tsx)
- P1-2 เพิ่ม "APPROVED" ใน PO_FLOW_STATUSES (nav.ts) — แท็บ/Kanban เห็นใบอนุมัติแล้ว
- P1-3 TRCloud push ล้ม → แถบเหลือง "บัญชียังไม่เข้า — กดส่งซ้ำ" + ปุ่ม retry (po-detail · grn-form) · ไม่โชว์เขียวหลอก
- P1-5 setShipmentStatus state-guard: updateMany WHERE status=prev (PREPARING→IN_TRANSIT→ARRIVED→RECEIVED · ห้ามถอย) (shipment-actions.ts:251)
- P1-6 GRN สินค้าซ้ำ → group productId ใน createGrn (1 สินค้า=1 layer) + ใช้ gl.costLayerId ใน bridge (grn-actions.ts · trcloud-bridge.ts:284)
- P1-7 in-transit/confirmTransfer race: atomic reserve updateMany WHERE status=IN_TRANSIT→CONFIRMED (count=0→idempotent return) + decrement แบบ {decrement} · autoPromote ก็ reserve ก่อน (transfer-actions.ts)
- P1-8 เติม qtyExpected จาก PO ต่อบรรทัด → เห็นรับเกิน/ขาด (po-actions.ts:797)
- P1-9 floor bottom-nav: ค้นหา → เบิกออก (mobile-bottom-nav.tsx:34 · ค้นหายังอยู่ในชีตเมนู)
- P1-10 scan-box ปิด autoFocus บน touch (เด้งคีย์บอร์ดมือถือ) · USB-gun/desktop ยัง focus (scan-box.tsx)
- P1-11 .dc-poline @media ≤480px → 1 คอลัมน์ (ช่องชื่อสินค้าไม่บีบ) (dc.css)
- STAFF-01 localStorage buffer รับ/เบิก/โอน ต่อ warehouse → เน็ตหลุด/รีเฟรชไม่ลืมรายการ (receive/issue/transfer-workspace · mirror count buffer)

## §bugs-deferred (CEO money/policy · ไม่ auto-fix — AUDIT §5)
1. ฐาน VAT ค่าผ่านพิธี (broker) มี 7% ไหม
2. นโยบายรับเกินยอดสั่ง (อนุญาต/cap)
3. GRN ต้นทุน 0 บล็อกไม่ให้ดันบัญชีไหม
4. DC_TRCLOUD_COMPANY_ID / DC_TRCLOUD_PROJECT = บริษัท/สาขาไหน
5. อนุมัติใบสั่งคนเดียวพอไหม

## §regression-pass
- bug class "เขียน fix แต่อ่าน field ผิด→fallback เงียบ" → ตรวจ trcloud-bridge fxRate path ✅
- bug class "client useState derive จาก server props ค้างตอน filter เปลี่ยน" → DC list ใช้ server-nav, ไม่พบ ✅
- bug class "write route serverClient+RLS บล็อก non-super" → DC ใช้ requireSession+org-scope ทุก action ✅
- bug class "migration เขียนแต่ไม่ apply" → ไม่มี migration รอบนี้ ✅

## §next-actions (CEO)
- ตัดสิน 5 ข้อ money/policy ข้างบน (โดยเฉพาะ DC_TRCLOUD_* ไม่งั้นต้นทุนค้าง outbox ไม่เข้าบัญชี)
- ลองกดใช้จริง: รับ PO ซ้ำ (กดรัว), ใบไทย (ดูต้นทุนไม่พอง), รับบางส่วน (รับเพิ่มได้), เปิดมือถือเลื่อนตาราง
