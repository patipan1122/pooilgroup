# AUDIT · DC Warehouse (คลังกลาง) — 2026-06-24

> /auditbigteam · 8-lens (SA/SEC · BE · UX/IA · QA · STAFF · MGR/OWN · FIN/AUD · WMS/Devil) · read-only · grep-backed · mobile+desktop.
> Module: foundation + floor ops + wave-B purchasing + mobile bottom-nav · deployed pooilgroup.com/dc.
> Architecture (TRCloud cost-book · DC zero-cost ledger · @@unique sourceKey · 2-step transfer · landed-cost CBM) = **PASS, all verified correct**.

## §1 Executive summary
โครงสร้างหลังบ้านแน่น (org-scope ครบ · role gate ครบ · idempotency stock ผ่าน · landed-cost ถูกหลักบัญชี · ไม่มี cost ซ้อน · bridge deferred สะอาด · ไม่มีปุ่มตาย). **แต่เจอ P0 ที่ต้องแก้ก่อนใช้จริง 5 กลุ่ม** (รับ PO ซ้ำ=ของ+เงินเด้งซ้ำ · ใบไทยแปลงค่าเงินซ้ำ=ต้นทุนพอง 5 เท่า · รับบางส่วนปิดใบเต็ม · ตารางหลังบ้านโดนตัดบนมือถือ · ไม่มี cron ของระหว่างทางค้างถาวร) + P1/P2 ปรับ usability มือถือ.

## §2 P0 — ต้องแก้ก่อน (verified · auto-fixable ใน /bigsolvebug ยกเว้นที่ตีกรอบ CEO)

| # | ปัญหา | ที่ (file:line) | แก้ | lens |
|---|---|---|---|---|
| P0-1 | **รับ PO ซ้ำ → ของ+ใบกำกับ TRCloud เด้งซ้ำ** (po-detail ปุ่มรับไม่ busy-lock · receivePo สร้าง GRN ใหม่ทุก call ไม่จองสถานะ · idempotency ผูกต่อ grnId คนละใบ=คนละ key) | po-detail.tsx:713 · po-actions.ts:748 | `if(pending)return` + receivePo จองสถานะ `updateMany WHERE status∈[ORDERED..AT_WAREHOUSE]→RECEIVED` ก่อนสร้าง GRN (count=0→error) | QA·DEV·WMS |
| P0-2 | **ใบสั่งซื้อไทยถูกแปลงค่าเงินซ้ำ → ต้นทุนพอง ~5 เท่า** (bridge ใช้ shipment.fxRate ?? po.fxRate ?? 1; ใบไทยราคาเป็นบาทแล้ว แต่ถ้ากล่อง/ชิปเมนต์มี fx → ราคา×fx) | trcloud-bridge.ts:133 · shipment ไม่เช็ค origin | ถ้า `po.origin===THAI` บังคับ fxRate=1 ใน bridge | FIN |
| P0-3 | **รับบางส่วนปิดใบเต็มทันที — รับของที่เหลือไม่ได้** (receivePo set RECEIVED เสมอ · PARTIAL ไม่เคยถูก set) | po-actions.ts:788 | เทียบ Σqtyได้รับ vs สั่ง → PARTIAL/RECEIVED · อนุญาต GRN ใบ 2 บน PARTIAL | WMS |
| P0-4 | **ตารางหลังบ้านโดนตัดบนมือถือ** (suppliers/products/shipments/receipts/transfers + detail tables ใส่ inline `overflow:hidden` ทับ safety-net → คอลัมน์ขวาเลื่อนดูไม่ได้) | products/page:114 · shipments/page:81 · receipts/page:84 · transfers/page:115 · suppliers-manager:85 · shipment-detail:262 · grn-detail:172 | เปลี่ยนเป็น `overflowX:auto` | UX·MGR |
| P0-5 | **ไม่มี cron DC reconcile → ของระหว่างทาง+auto-promote ไม่ทำงาน ค้างถาวร** (vercel.json 0 DC cron · runDcReconcile รันเมื่อเปิดหน้าเท่านั้น) | vercel.json · reconcile.ts:123 | เพิ่ม cron `/api/dc/reconcile` (⚠️เช็คโควต้า Vercel cron ~31 limit) | WMS·DEV |

## §3 P1 — ควรแก้ (auto-fixable)
- **P1-1** เมนูเดสก์ท็อป (sidebar + office hub CARDS) ขาด "การโอน" + "กระทบยอด" → เข้าไม่เจอบนคอม. fix modules.ts dc nav + office/page CARDS. (UX·DEV)
- **P1-2** สถานะ APPROVED หายจากแท็บกรอง+Kanban (PO_FLOW_STATUSES ข้าม). fix เพิ่ม "APPROVED". (MGR · nav.ts:70)
- **P1-3** TRCloud push ล้มแต่ UI บอก "สำเร็จ" (ของลงคลังแล้ว บัญชีขาด). fix อ่าน res.trcloud.posted → banner เหลือง + ปุ่มส่งซ้ำ. (QA·FIN · trcloud-bridge:484)
- **P1-4** floor receive/issue/transfer/move เน็ตหลุด=รายการหายหมด (มีแต่ count ที่ buffer). fix localStorage buffer ต่อ warehouse. (STAFF)
- **P1-5** setShipmentStatus ไม่มี state-guard (ถอย/ข้ามได้ · ปลดแก้หลังคิดต้นทุน). fix `updateMany WHERE status=prev`. (BE·QA · shipment-actions:270)
- **P1-6** GRN สินค้าซ้ำ 2 บรรทัด → cost layer Map ทับ → ต้นทุนเพี้ยน. fix group productId ใน createGrn / ใช้ gl.costLayerId เสมอ. (BE·FIN · trcloud-bridge:288)
- **P1-7** in-transit decrement นอก tx + ไม่ idempotent + confirmTransfer ไม่มี atomic guard → in-transit drift/หัก 2 เท่าตอน race. fix guard `updateMany WHERE status=IN_TRANSIT` + ผูก decrement เข้า idempotency. (BE·WMS · transfer-actions:306,343)
- **P1-8** over-receive ไม่จำกัด + qtyExpected=0 (ไม่เติมจาก PO) → รับเกินยอดสั่งเงียบ. fix เติม qtyExpected + เตือนเมื่อเกิน. (WMS·QA)
- **P1-9** floor bottom-nav ขาด "เบิกออก" (ใช้บ่อยกว่าค้นหา). fix สลับแท็บ. (STAFF)
- **P1-10** scan-box autoFocus เด้งคีย์บอร์ดมือถือทุกหน้า. fix ปิด autoFocus บน touch. (STAFF)
- **P1-11** PO create ช่องชื่อสินค้าบีบ ≤400px. fix breakpoint ≤480 stack. (UX)

## §4 P2 — เก็บกวาด
note บังคับใน receive-po (ทำ optional/ปุ่มลัด "ของครบ") · ปุ่มไอคอน <44px · seed button ไม่ admin-gate+ไม่ confirm · count lookup ไม่เช็ค canDcFloor · count ไม่ freeze (delta กลืน movement ระหว่างนับ → flag systemQtyAtScan) · assignWarehouseUser ไม่เช็ค userId-in-org · refreshFxRate dead code (wire ปุ่มรีเฟรช) · FIN-03 GRN ต้นทุน 0 เงียบ · FIN-05 cost-layer ไม่มี createdBy · FIN-06 PO ไม่เก็บ fxDate · Kanban ไม่มี hint เลื่อน · office หน้าอื่นไม่มี sub-nav · qty stepper +1 (ควร +10/box) · label popup ถูกบล็อกบนมือถือ.

## §5 CEO decisions (เงิน/นโยบาย — ไม่ auto-fix)
1. **ฐาน VAT นำเข้า:** ค่าผ่านพิธี (broker) มี VAT 7% ไหม? (FIN-02 — เลขที่โชว์ vs ที่เข้า ภ.พ.30 ไม่ตรงเพราะ broker อยู่ในฐานคนละแบบ)
2. **รับเกินยอดสั่ง:** อนุญาตรับ > สั่งไหม (ของแถม/กล่องผิด) หรือ cap?
3. **GRN ต้นทุน 0:** บล็อกไม่ให้ดันเข้าบัญชีจนเติมราคา ใช่ไหม?
4. **TRCloud env:** `DC_TRCLOUD_COMPANY_ID` + `DC_TRCLOUD_PROJECT` = บริษัท/สาขาไหน (ไม่งั้นต้นทุนค้าง outbox ไม่เข้าบัญชี)
5. **อนุมัติคนเดียว:** ตอนนี้คนสร้าง=อนุมัติได้ (ไม่ล็อก) — โอเคไหม

## §6 Sign-off
| lens | สถานะ | เงื่อนไข |
|---|---|---|
| SA/SEC | 🟡 CONDITIONAL | 3 P2 defense-in-depth |
| BE | 🔴→fix | P0-1, P1-5/6/7 |
| UX/IA | 🔴→fix | P0-4, P1-1/2/11 (mobile) |
| QA | 🔴→fix | P0-1, P1-3/8 |
| STAFF | 🟡 | P1-4/9/10 (mobile floor) |
| MGR/OWN | 🟡 | P0-4, P1-1/2 + CEO §5 |
| FIN/AUD | 🔴→fix | P0-2, P1-6, §5 money decisions |
| WMS | 🔴→fix | P0-3/5, P1-7/8 |

**Verdict:** สถาปัตยกรรมผ่าน · 5 P0 + 11 P1 ต้องแก้ (ส่วนใหญ่ auto-fixable) → ส่งต่อ /bigsolvebug. Money decisions §5 รอ CEO.
