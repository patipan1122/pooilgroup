# AUDIT · CashHub — Café Amazon · 2026-06-14

> /auditbigteam (no-question mode) · read-only compliance audit ก่อน pilot หลายสาขา
> 8 personas (FIN · OFC · AUD · SA · SEC · BA · QA · DEVIL) × adversarial verify · 54 agents
> โมดูล: import POS → คีย์ IV เข้า TRCloud → settlement → ส่งเข้า bank-recon → match flowback
> ⚠️ READ-ONLY: ไม่ยิงเงินจริง · ไม่แก้โค้ดในรอบนี้ (paper audit) · ทุก finding ผ่านตัวตรวจแบบค้าน

---

## 1. Executive Summary

ตรวจพบ **38 ปัญหายืนยันแล้ว** (P0=2 · P1=16 · P2=20) — ตัวตรวจแบบค้านปัดตก 8 ข้อที่โค้ดกันไว้อยู่แล้ว/เข้าใจผิด (ดู §6).

**ภาพรวม:** โครงสร้างหลักแข็งแรง — VAT/GL ถูกต้องตามใบจริง (Σchannels=total+vat=gross มี checksum 2 ชั้น), idempotency ของ reconcile INSERT ตรงกับ partial-unique index จริง, ทุก money-write gate super_admin + verify session + module entitlement, ไม่พบ injection ใน payload TRCloud. **แต่** มี "รูเงินเงียบ" ที่ต้องแก้ก่อนเปิดหลายสาขา/ก่อนให้นักบัญชีใช้จริง.

**3 เรื่องที่อันตรายสุด (ต้องแก้ก่อน pilot):**
1. 🔴 **สาขา "เทศบาลจักราช" พังทั้งสาขา** — config ตั้ง `storeCode=""` (ยังไม่รู้รหัส POS) แต่ import เซฟแถวด้วยรหัสจริงจากไฟล์ → พอสร้าง IV จริงในTRCloud แล้ว DB อัปเดตด้วย key `""` = แมตช์ 0 แถว → หน้าจอขึ้น "ยังไม่มี IV" ตลอด, กดสร้างซ้ำได้, match/reconcile ของสาขานี้ไม่ทำงานเลย. **นี่คือเคสหลายสาขาที่เพิ่งเตรียมไว้พอดี.**
2. 🔴 **ออกใบกำกับภาษีซ้ำได้** — กันใบซ้ำด้วยการ search-แล้ว-create (TOCTOU) ไม่มี lock ที่ฐานข้อมูล → 2 แท็บ/2 คนกดวันเดียวกันพร้อมกัน = ได้ใบกำกับ 2 ใบ นับ VAT ซ้ำใน ภ.พ.30.
3. 🟠 **เงินช่องต่ำกว่าขั้นต่ำหายถาวร** — UI สัญญา "รอสะสม" แต่ไม่มี logic สะสมจริง → Lineman ขายวันละ <500 จะไม่เข้า reconcile เลย ทั้งที่เงินเข้าธนาคารจริง = ยอดเดือนไม่มีวันปิดครบ. (ต้องให้ CEO เลือกนโยบาย)

---

## 2. Scope & Method

- **IN:** lib/cashhub/amazon-{parse,trcloud,data,settlement,settlement-data}.ts · app/(admin)/cashhub/amazon/{page,amazon-view,amazon-excel-grid,settings/*}.tsx · app/api/cashhub/amazon-import/{preview,push,match} · amazon-settlement/{save,reconcile} · migrations 2 ฉบับ
- **OUT:** TRCloud api-connector ภายใน, bank-recon engine (โมดูลแยก), Pool core auth
- **Method:** discovery 8 lens → ทุก finding ส่งให้ verifier อิสระอ่านโค้ดจริงเพื่อ "ค้าน" (default skeptic) → เก็บเฉพาะที่ยืนยันว่าจริง+ยังไม่ถูก handle

---

## 3. 🔴 P0 — ต้องแก้ก่อน pilot

### P0-1 · เทศบาลจักราช storeCode="" → สร้าง IV จริงแล้วสถานะใน DB ไม่อัปเดต (match/reconcile พังทั้งสาขา)
- **ที่:** `app/api/cashhub/amazon-import/push/route.ts:62 + lib/cashhub/amazon-trcloud.ts:62`
- **ปัญหา:** config สาขา เทศบาลจักราช ตั้ง storeCode="" (amazon-trcloud.ts:62 — ยังไม่ทราบรหัส POS). แต่ตอน import แถวถูกเซฟด้วย parsed.storeCode จริงของไฟล์ (preview/route.ts:77 ใช้ parsed.storeCode!). เวลากดสร้าง IV: push/route.ts:62 เรียก markIvPosted(..., cfg.storeCode, ...) = markIvPosted(..., "", ...) → amazon-data.ts:281 .eq("store_code", "") แมตช์ 0 แถว. ผลคือ IV ถูกสร้างในTRCloud จริง (ลงบัญชี+ภาษีจริง) แต่ในแอปแถวยังขึ้น 'ยังไม่มี IV' ตลอด → ผู้ใช้กดสร้างซ้ำได้อีก (dedup กันที่ TRCloud ระดับ search เท่านั้น ดู finding ถัดไป). เช่นเดียวกัน match/route.ts:34-35 และ reconcile (sendDaysToReconcile) ก็ใช้ cfg.storeCode="" → loadAmazonDays คืน 0 แถว → เทียบ/ส่ง reconcile ของสาขานี้ไม่ทำงานเลย. นี่เป็นบั๊กระดับ data-consistency ของเงิน/ภาษีจริงทันทีที่ไฟล์ POS สาขาเทศบาลจักราชถูกอัป.
- **แก้:** อย่าใช้ cfg.storeCode เป็น key เขียน DB. ใช้ store_code จริงจากไฟล์/แถวที่เซฟ: ส่ง body.storeCode (หรือ parsed.storeCode ที่ resolve มาแล้ว) เข้า markIvPosted/loadAmazonDays/applyIvMatch/sendDaysToReconcile แทน cfg.storeCode ทุกจุด. cfg ใช้แค่หาสูตร TRCloud (project/contact) เท่านั้น ไม่ใช่ identity ของแถวใน DB. เสริม: ตอน import ให้บันทึก storeCode ที่ resolve แล้วลง cfg map หรือ require ว่าทุกสาขาต้องมี storeCode ก่อนเปิดใช้.
- *(persona: SA · ความมั่นใจ verifier: 90%)*

### P0-2 · สร้าง IV แบบ search-then-create ไม่มี lock → กดพร้อมกัน/ลูปเร็ว = ใบกำกับซ้ำ นับ VAT ซ้ำ
- **ที่:** `lib/cashhub/amazon-trcloud.ts:222-242 + app/(admin)/cashhub/amazon/amazon-view.tsx:248-290`
- **ปัญหา:** dedup ใน createAmazonIv ทำด้วย iv/search.php แล้วค่อย iv/create.php (TOCTOU). ไม่มี idempotency key ฝั่ง TRCloud และไม่มี guard ฝั่งเรา (cashhub_amazon_daily.iv_doc_id ไม่ได้ถูกเช็คก่อนยิง). สถานการณ์จริง: super_admin 2 แท็บ/2 คน กด 'ส่ง TRCloud' วันเดียวกันพร้อมกัน → ทั้งคู่ search เห็น 'ยังไม่มี' → create ทั้งคู่ = IV ซ้ำ 2 ใบ รายได้+VAT ถูกนับ 2 เท่าในภ.พ.30. แม้แต่คนเดียว: createAllReady (amazon-view.tsx:260-286) ยิงทีละใบห่าง 1300ms แต่ throttle นี้กัน 429 ไม่ได้กัน race — ถ้า user กด 'สร้าง IV ที่ยังไม่มี' พร้อมกับกดปุ่ม 'ส่ง TRCloud' รายวัน หรือ refresh แล้วกดซ้ำระหว่างลูปยังไม่จบ ก็ได้ใบซ้ำ. ปุ่ม busy เป็น client-state เท่านั้น ไม่กันข้ามแท็บ/ข้าม user.
- **แก้:** เพิ่ม guard ฝั่ง DB ก่อนยิง create: เช็ค cashhub_amazon_daily แถวนั้นว่ามี iv_doc_id แล้วหรือยัง (อ่านสด ไม่ใช่ค่าจาก client) และใช้ optimistic claim — UPDATE ... SET iv_status='creating' WHERE org+store+date AND iv_status<>'posted' RETURNING; ถ้า 0 แถว = มีคนกำลังทำ/ทำแล้ว ให้ bail. หรือดีกว่า: ขอ idempotency/external-ref กับ TRCloud (document_number/external id = amz-store-date) ให้ TRCloud ปฏิเสธซ้ำเอง. อย่างน้อยควร serialize ต่อ (org,store,date) ด้วย advisory lock / unique claim ก่อน create.
- *(persona: SA · ความมั่นใจ verifier: 88%)*

---

## 4. 🟠 P1 — ควรแก้ก่อนให้นักบัญชีใช้จริง

| # | ปัญหา | ที่ | persona |
|---|---|---|---|
| 1 | กด "ส่งเข้า reconcile" สำเร็จแล้วหน้าไม่ refresh → คอลัมน์ "กระทบยอด" + แถบสรุปไม่อัปเดต ทำให้กดส่งซ้ำ/สับสน | `app/(admin)/cashhub/amazon/amazon-view.tsx:161-193 (sendReco` | OFC |
| 2 | ยอดต่ำกว่าขั้นต่ำ (Lineman <500) ถูกตัดทิ้งถาวร — UI บอก "รอสะสม" แต่ไม่เคยสะสม → เงินเข้าธนาคารจริงแต่ไม่มีรายการให้กระทบ | `lib/cashhub/amazon-settlement-data.ts:142 (` | OFC |
| 3 | เงินช่องทางต่ำกว่าขั้นต่ำ "รอสะสม" แต่ไม่เคยสะสมจริง → เงินหายจาก reconcile ถาวร | `lib/cashhub/amazon-settlement.ts:78-90` | BA |
| 4 | createAllReady (สร้าง IV ที่ยังไม่มี ทั้งเดือน) กลืน error ทุกใบ — fail เงียบ ไม่บอกว่าใบไหนพลาด | `app/(admin)/cashhub/amazon/amazon-view.tsx:248-290` | DEVIL |
| 5 | ช่องต่ำกว่าขั้นต่ำ (pending) ถูกทิ้งถาวร — ไม่มีกลไก "สะสม" จริง เงินหายจาก reconcile | `lib/cashhub/amazon-settlement.ts:84-90, lib/cashhub/amazon-s` | FIN |
| 6 | Re-import ไฟล์แก้ไขทับยอด POS แต่คงสถานะ ✅ match เก่า → คนกระทบยอดเห็นเขียวลวง | `lib/cashhub/amazon-data.ts:44-64 (upsert ไม่แตะ iv_*/match_s` | OFC |
| 7 | store_code ไม่ตรงกัน: เซฟด้วยรหัสจากไฟล์ POS แต่ push/match/reconcile ใช้รหัสจาก config | `app/api/cashhub/amazon-import/preview/route.ts:76` | QA |
| 8 | สาขาที่ config มี storeCode ว่าง → match/markIvPosted/reconcile วิ่งบน store_code="" ไม่ตรงกับแถวที่เซฟไว้ | `lib/cashhub/amazon-trcloud.ts:62, app/api/cashhub/amazon-imp` | FIN |
| 9 | markIvPosted + dedup ปั๊ม match="match" ด้วยยอด POS โดยไม่ตรวจยอด IV จริง → ปิดบัง mismatch | `lib/cashhub/amazon-data.ts:258-283, lib/cashhub/amazon-trclo` | FIN |
| 10 | dedup กันใบ IV ซ้ำเป็น check-then-act → race สร้างใบกำกับภาษีซ้ำได้จริง | `lib/cashhub/amazon-trcloud.ts:221-242 (` | AUD |
| 11 | amount_satang>0 CHECK ทำให้ทั้งลูป reconcile ล้มกลางคัน (ส่งบางวัน ขาดบางวันเงียบ ๆ) | `lib/cashhub/amazon-settlement-data.ts:165-190` | SA |
| 12 | หลายสาขาพังเงียบ: import คีย์ store_code จริง แต่ push/เทียบ/reconcile ใช้ cfg.storeCode ที่ hardcode (จักราช="") | `app/api/cashhub/amazon-import/push/route.ts:62 / match/route` | BA |
| 13 | เจอใบเดิม (dedup) แล้วปั๊มเขียว "match" ทั้งที่ไม่เคยเทียบยอดจริง — ซ่อนใบกำกับยอดผิด | `lib/cashhub/amazon-trcloud.ts:232-241` | DEVIL |
| 14 | markIvPosted + reconcile ใช้ cfg.storeCode (ว่างสำหรับสาขาจับคู่ด้วยชื่อ) → สถานะไม่อัปเดต/รายการหายเงียบ | `app/api/cashhub/amazon-import/push/route.ts:57-67` | DEVIL |
| 15 | ส่งยอด net-after-fee เข้า reconcile แต่ธนาคารรับยอดเต็ม → Grab/EDC กระทบยอดไม่ลงทั้งเดือน | `lib/cashhub/amazon-settlement-data.ts:150 (amountSatang = Ma` | OFC |
| 16 | ปุ่ม "ส่งซ้ำ (🔁 force)" โผล่ทุกวันบนตารางจริง — ปุ่มทดสอบที่สร้างใบกำกับ/VAT ซ้ำจริง อยู่ปนกับงานประจำ | `app/(admin)/cashhub/amazon/amazon-excel-grid.tsx:216-226` | OFC |

**รายละเอียด P1 ที่เป็นกลุ่มเดียวกัน (root-cause clusters):**

- **store_code ไม่ตรงกัน (import ใช้รหัสไฟล์ · push/match/reconcile ใช้ cfg.storeCode)** → P0-1 + P1 หลายข้อ (FIN/QA/BA/DEVIL) เป็นต้นตอเดียวกัน. แก้จุดเดียว = หายหลายข้อ: ใช้ store_code จริงจากแถว ไม่ใช่ cfg.storeCode เป็น key เขียน DB.
- **เงินต่ำกว่าขั้นต่ำ "รอสะสม" แต่ไม่สะสมจริง** → 3 personas (OFC/BA/FIN) ชี้ตรงกัน. ต้องให้ CEO เลือกนโยบาย (สะสมจริง / ส่งทุกวัน / ตัดทิ้งแต่โชว์ยอด).
- **net-after-fee ≠ ยอดที่ธนาคารรับ** (Grab 18%/EDC 0.7%) → แพลตฟอร์มมักโอนยอดเต็มแล้วเก็บค่าธรรมเนียมแยก → reconcile ไม่ลงทั้งเดือน. ต้องยืนยัน flow เงินจริงกับ CEO.
- **ปั๊มเขียว "match" โดยไม่เทียบยอด IV จริง** (dedup เจอใบเดิม → mark match ด้วยยอด POS) + re-import ทับยอดแต่คงสถานะเขียว → ซ่อนใบที่ยอดผิด.
- **fail เงียบ:** createAllReady ไม่อ่าน response → รายงาน "เสร็จ" เสมอ · sendReconcile ไม่ refresh หน้า → คนกระทบยอดงง กดซ้ำ.
- **amount_satang>0 CHECK** อาจทำให้ทั้งลูป reconcile ล้มกลางคัน (ส่งบางวัน ขาดบางวันเงียบ).

---

## 5. 🟡 P2 — robustness / UX / ภายหลัง

| # | ปัญหา | ที่ | persona |
|---|---|---|---|
| 1 | สร้าง IV หลายใบ (createAllReady) ล้มเหลวกลางทางแต่รายงานว่าสำเร็จครบทุกใบ | `app/(admin)/cashhub/amazon/amazon-view.tsx:260-289` | BA |
| 2 | POS เพิ่มช่องทางใหม่ที่ยังไม่มี c-var: บล็อกถูกต้องแต่ไม่บอกว่าช่องไหน (unmapped ประกาศแต่ไม่เคยเติม) | `lib/cashhub/amazon-parse.ts:132-145,168` | BA |
| 3 | totalPending ถูกคำนวณแต่ไม่เคยแสดง/ส่งออก — ผู้ใช้มองไม่เห็นเงินที่ค้างไม่เข้า reconcile | `lib/cashhub/amazon-settlement.ts:90-96, app/(admin)/cas` | FIN |
| 4 | ความพยายามสร้าง/ส่งซ้ำ IV ที่ 'ล้มเหลว' ไม่ถูก audit เลย | `app/api/cashhub/amazon-import/push/route.ts:54-93` | AUD |
| 5 | ส่งเข้า reconcile สำเร็จแล้วหน้าจอไม่รีเฟรช → คอลัมน์กระทบยอดยังเป็น "—" เสี่ยงกดส่งซ้ำ/เข้าใจผิดว่าไม่ทำงาน | `app/(admin)/cashhub/amazon/amazon-view.tsx:161-193` | BA |
| 6 | แก้ค่าธรรมเนียม%/บัญชีปลายทาง — audit ไม่เก็บ old→new (ตามไม่ได้ว่าใครเปลี่ยนเงินไปไหน) | `app/api/cashhub/amazon-settlement/save/route.ts:42-48 (` | AUD |
| 7 | VAT ถูกคิดบนยอดส่วนลด/Redeem (c7/c8/c9/c11) เพราะรวมอยู่ใน gross — ควรยืนยันนโยบายภาษี | `lib/cashhub/amazon-parse.ts:147-148, lib/cashhub/amazon` | FIN |
| 8 | dedup เจอใบ IV ของวันเดียวกันใน project แล้วเหมา 'match' แม้เป็นใบที่คีย์มือยอดต่างกัน | `lib/cashhub/amazon-trcloud.ts:222-241` | AUD |
| 9 | ออกใบกำกับภาษี/ใบซ้ำเป็น single-actor — ไม่มี maker-checker; gate ของ force เป็น string ฝั่ง client | `app/api/cashhub/amazon-import/push/route.ts:44-52` | AUD |
| 10 | IDOR ข้าม tenant: companyId/bankAccountId ใน settlement/save ไม่ถูกตรวจว่าเป็นของ org ตัวเอง → reconcile ยิงรายได้ลงบริษัท/บัญชีของ org อื่นได้ | `app/api/cashhub/amazon-settlement/save/route.ts:33-39` | SEC |
| 11 | reconcile insert ไม่ยืนยันว่า company_id ที่ตั้งไว้เป็น 'บริษัทในเครือ org นี้' ตอน runtime (กันค่าค้างจาก config ที่อาจ stale/ผิด) | `lib/cashhub/amazon-settlement-data.ts:138-159` | SEC |
| 12 | วันที่มีแต่ส่วนลด/Redeem (gross=0) แสดงรวมในตาราง/ติดปัญหา แต่ business meaning กำกวม | `lib/cashhub/amazon-parse.ts:153 / app/(admin)/cashhub/a` | BA |
| 13 | reconcileCell โชว์ 🟢/🟡 ระดับวัน แต่ sourceRef เป็นรายช่องทาง — bankAccountId ต่างช่องไม่ได้ผลในทางปฏิบัติ + grid รวมหยาบ | `app/(admin)/cashhub/amazon/amazon-excel-grid.tsx:121-13` | DEVIL |
| 14 | ช่องทางใหม่ที่ POS เพิ่ม (มีเงินจริง) ถูกตกหล่นจาก Σchannels + ฟิลด์ unmapped เป็น dead code | `lib/cashhub/amazon-parse.ts:135-145, 156-157, 168` | FIN |
| 15 | แถบสรุป reconcile นับเฉพาะช่องที่ตั้งบัญชีแล้ว ทำให้ % แมตช์เข้าใจผิดว่าครบ ทั้งที่บางช่อง/บางวันไม่เคยถูกส่ง | `app/(admin)/cashhub/amazon/amazon-view.tsx:511-536` | OFC |
| 16 | ร่องรอยจากใบ IV กลับไปไฟล์ POS/ผู้นำเข้าต้นทางถูกทับเมื่อ re-import | `lib/cashhub/amazon-data.ts:44-66 (upsertAmazonDays)` | AUD |
| 17 | config.companyId/bankAccountId ไม่ถูก validate ว่าเป็นของ org เดียวกัน ก่อนยิงเข้า ledger_revenue_entry | `app/api/cashhub/amazon-settlement/save/route.ts:33-39` | SA |
| 18 | ปุ่ม force-resend (🔁) สร้างใบกำกับภาษีซ้ำจริง ลอยอยู่ทุกแถวใน prod — foot-gun ถาวร | `app/(admin)/cashhub/amazon/amazon-excel-grid.tsx:216-22` | DEVIL |
| 19 | Scale: fetchAmazonIvs/match ดึงทั้งเดือน limit 500 + reconcile ยิง INSERT ทีละแถว N วัน×M ช่อง → ช้า/เสี่ยง timeout ที่ 10x | `lib/cashhub/amazon-trcloud.ts:151-156` | SA |
| 20 | dedup/match พึ่ง iv/search.php กรองด้วย project อย่างเดียว — ถ้า API ไม่กรอง project จริง = false duplicate ข้ามวันที่ควรคีย์ | `lib/cashhub/amazon-trcloud.ts:151-156, 222-234` | DEVIL |

ไฮไลต์ P2 ที่ควรอ่าน: **IDOR ข้าม tenant** (settlement/save รับ companyId/bankAccountId จาก body ไม่ตรวจว่าเป็นของ org ตัวเอง — gated super_admin แต่ข้ามขอบบริษัทได้) · **force-resend (🔁) เป็น foot-gun ถาวรใน prod** (ปุ่มทดสอบสร้างใบซ้ำจริง โผล่ทุกแถว) · **VAT คิดบนส่วนลด/Redeem** (ต้องยืนยันนโยบายภาษี) · **audit ไม่เก็บ old→new ตอนแก้ค่าธรรมเนียม/บัญชี** · **ช่องทางใหม่ของ POS ที่ยังไม่มี c-var ไม่ถูกแจ้งชื่อ** (`unmapped` เป็น dead code แต่ checksum ยังกันเงินหายได้).

---

## 6. ✅ ปัดตก (false positives) — โค้ดกันไว้แล้ว/เข้าใจผิด

ตัวตรวจแบบค้านปัดตก 8 ข้อ (พิสูจน์ความเข้มงวดของรอบนี้):
- checksum 2 ชั้นไม่ขัดกันในทิศอันตราย (parse <0.5 vs createIv >1 — vat เป็น residual ไม่ใช่ปัดอิสระ)
- ไฟล์ที่อ่าน storeCode ไม่ได้ → parse คืน null **พร้อมกัน** กับ storeLabel เสมอ จึงไม่ชน NOT NULL อย่างที่กลัว
- field `unmapped` ตายซากจริง แต่ money-safety ถูกกันด้วย checksum แล้ว (ลดเป็น P2 ไม่ใช่ P1)
- duplicate-return ที่กลัว ivId ว่าง → field mapping ถูก LIVE-PROBE แล้ว ไม่ใช่เดา
- EDC (c12) ถูกนับใน Σchannels checksum จริง

---

## 7. 🎯 Top 5 Decisions — ต้องให้ CEO เคาะ

1. **นโยบายขั้นต่ำที่โอน (min-settle)** — ปัจจุบันเงิน <ขั้นต่ำหายถาวร. เลือก: (ก) สะสมจริงข้ามวันแล้วปล่อยเมื่อครบ · (ข) ส่งทุกวันให้ bank-recon จับ N:M เอง (แนะนำ — ง่าย+ไม่หาย) · (ค) ตัดทิ้งแต่โชว์ยอดค้างให้เห็น. **blast radius: สูง (เงินหายจากระบบตรวจ)**
2. **net หรือ gross เข้า reconcile** — Grab/Lineman/Shopee โอนเงินยอดเต็มแล้วเก็บค่าธรรมเนียมแยกจริงไหม? ถ้าใช่ ต้องส่ง gross เข้า reconcile (ไม่ใช่ net) ไม่งั้นกระทบยอดไม่ลง. **blast radius: สูง**
3. **VAT บนส่วนลด/Redeem (c7/c8/c9/c11)** — ตอนนี้ VAT คิดบน gross ที่รวมส่วนลด/แต้ม. ถูกต้องตามนโยบายภาษีไหม? **blast radius: กลาง (ความถูกต้องภาษี)**
4. **ปุ่มส่งซ้ำ 🔁 (force-resend) ใน prod** — ควรเอาออก/ซ่อนหลัง flag/ย้ายไปหน้า dev เท่านั้น? (สร้างใบกำกับซ้ำจริง = foot-gun). **blast radius: กลาง**
5. **แก้ P0 ทั้ง 2 + P1 ปลอดภัยตอนนี้เลยไหม** — storeCode key, race-lock กันใบซ้ำ, router.refresh, createAllReady รายงานจริง. ผมแนะนำแก้ก่อน pilot. **blast radius: สูง (แตะ money-write path → ต้องเทสจริง 1 ใบ)**

---

## 8. ลำดับแก้ที่แนะนำ (ถ้า CEO อนุมัติ — รอบถัดไป)

**Batch A (P0 · safe-ish · แก้จุดเดียวคุมหลาย finding):**
1. เลิกใช้ `cfg.storeCode` เป็น key เขียน DB ทุกจุด → ใช้ store_code จริงจากแถว/ไฟล์ (push/match/reconcile/markIvPosted) — ปิด P0-1 + P1 store_code cluster
2. กันใบ IV ซ้ำที่ DB: optimistic claim `UPDATE ... SET iv_status='creating' WHERE ... AND iv_status<>'posted' RETURNING` ก่อนยิง create — ปิด P0-2

**Batch B (P1 · ปลอดภัย ไม่ต้องตัดสินนโยบาย):**
3. `sendReconcile` เพิ่ม `router.refresh()` + เติม deps
4. `createAllReady` อ่าน response → สรุป "สำเร็จ X · ล้มเหลว Y วัน: [...]" + หยุดเมื่อเจอ 429
5. ไม่ปั๊ม match=match จาก dedup โดยไม่เทียบยอด IV จริง / re-import ล้าง match_state ถ้ายอดเปลี่ยน

**Batch C (รอ CEO เคาะนโยบาย §7):** min-settle · net-vs-gross · VAT discount · force button

**Batch D (P2 ภายหลัง):** IDOR org-check, audit old→new, unmapped surfacing, scale

---
*ทั้งหมดเป็น read-only audit — ยังไม่มีการแก้โค้ด. รอ CEO ตัดสิน §7 + อนุมัติ Batch A/B.*