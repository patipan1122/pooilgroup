# AUDIT · RentSpace (บริหารพื้นที่เช่า) · 2026-08-07

> ตรวจบน **production (setup `e5aa626f`)** · 12 เลนส์ (PM/BA/SA/FE/BE/QA/QC/FIN/AUD/OFC/SEC/DEVIL) · adversarial-verify ทุก P0/P1
> ผล: **1 P0 + 18 P1 + 5 P2 (verified) · P2 อีก 30 · refuted 1 · uncertain 1** · 38 agents · 2.74M tok
> ⚠️ auditbigteam = **spec เท่านั้น ไม่แตะโค้ด** · การแก้จริงอยู่เฟส /bigsolvebug (รอ CEO เคาะ)

---

## §0 สรุปผู้บริหาร (1 ย่อหน้า)

RentSpace ทำงานได้และสูตรคิดเงินหลัก (VAT exempt-first, ส่วนลด, มิเตอร์สะสม) **ถูกต้อง** — แต่มีจุดเสี่ยงเงิน/ภาษี **1 เรื่องใหญ่ (P0)** และ **18 เรื่องต้องแก้ (P1)** ที่รวมกันเป็น 4 ธีม: (1) **ธุรกรรมไม่ atomic** — เขียนเงินหลายสเต็ปไม่อยู่ในกล่องเดียว ถ้า server ตายกลางคันหรือกดซ้ำ ยอดเพี้ยนถาวร (2) **บิลที่ออกไปแล้วเปลี่ยนเงียบ** เมื่อแก้ VAT/มิเตอร์ในสัญญาย้อนหลัง (3) **ด่านสิทธิ์หลุด** — actSaveContract แก้ห้ององค์กรอื่นได้ + drawer เปิด PII ให้คนไม่มีสิทธิ์ (4) **RentSpace เป็นเกาะแยกจากบัญชี** — บิล/VAT/เงินไม่ไหลเข้า GL/TRCloud เลย และเอกสารเป็น "ใบเสร็จ" ไม่ใช่ "ใบกำกับภาษี". ส่วนใหญ่แก้ที่ระดับโค้ด (ไม่ต้อง redesign), มี 1 จุดต้อง migration (snapshot VAT ลงบิล).

---

## §1 🔴 P0 (ต้องแก้ทันที · 1)

| # | ปัญหา | ที่ | แก้ |
|---|---|---|---|
| P0-1 | **VAT % ไม่ถูกแช่แข็งลงบิล** — `RentalBill` ไม่มีคอลัมน์ vatPercent, `recomputeBillTotals` อ่านเรตจากสัญญาสด ๆ ทุกครั้ง → แก้ VAT ในสัญญาย้อนหลัง แล้วบิลเก่า (ที่พิมพ์ใบกำกับภาษีส่งไปแล้ว) VAT+ยอดรวมเปลี่ยนเงียบ เมื่อมีการรับชำระ/แก้บิลใด ๆ | [lib/rentspace/billing.ts:356](lib/rentspace/billing.ts#L356) | เพิ่มคอลัมน์ `vatPercent` บน RentalBill (migration) · snapshot ตอน createBill · recompute อ่านจากบิล · backfill ใบเก่า |

---

## §2 🟡 P1 verified (18)

### ธีม A · ธุรกรรมเงินไม่ atomic (crash/double-click = ยอดเพี้ยนถาวร)
| # | ปัญหา | ที่ |
|---|---|---|
| A1 | รับชำระ: create payment + increment paidAmount ไม่อยู่ tx เดียว → server ตายกลางคัน = มีแถวเงินแต่ paidAmount ไม่ขยับ (drift ถาวร) | [_actions.ts:1749](app/(admin)/rentspace/_actions.ts#L1749) |
| A2 | บันทึกชำระ (collections path) ก็ไม่ atomic เช่นกัน | [_actions.ts:1733](app/(admin)/rentspace/_actions.ts#L1733) |
| A3 | มัดจำ: คืน/ริบพร้อมกัน 2 แท็บ → อ่าน balance ซ้ำ → คืนเกิน (over-refund) | [_actions.ts:1000](app/(admin)/rentspace/_actions.ts#L1000) |
| A4 | รับเงินประกันกดซ้ำ (double-click) ไม่มี dedup → balance บวม 2 เท่า | [_actions.ts:1008](app/(admin)/rentspace/_actions.ts#L1008) |
| A5 | Dedup รับชำระกว้างเกิน (120 วิ match ยอด+วิธี+วัน) → ผู้เช่า 2 คนจ่ายเท่ากัน ก้อนที่ 2 หายเงียบ (UI ขึ้นสำเร็จ) | [_actions.ts:1719](app/(admin)/rentspace/_actions.ts#L1719) |

### ธีม B · บิลที่ออกแล้วเปลี่ยนเงียบ / ตัวเลขไม่ตรงข้ามหน้า
| # | ปัญหา | ที่ |
|---|---|---|
| B1 | บิลไม่เก็บอัตรา VAT ตัวเอง (พี่น้องของ P0-1) — แก้ VAT สัญญา → ยอดค้างบิลเก่าเปลี่ยน | [lib/rentspace/billing.ts:352](lib/rentspace/billing.ts#L352) |
| B2 | super_admin แก้เลขมิเตอร์งวดที่ออกบิลแล้ว → บิลไม่คิดค่าน้ำ/ไฟใหม่ = บิลกับมิเตอร์ไม่ตรง | [_actions.ts:1228](app/(admin)/rentspace/_actions.ts#L1228) |
| B3 | "รับชำระเดือนนี้" หน้า payments (นับตามวันจ่าย) vs analytics (นับตามงวดบิล) = คนละฐาน ตัวเลขไม่ตรง | [payments/page.tsx:41](app/(admin)/rentspace/payments/page.tsx#L41) |

### ธีม C · ด่านสิทธิ์ / cross-org
| # | ปัญหา | ที่ |
|---|---|---|
| C1 | **actSaveContract ไม่ตรวจเจ้าของ unit/project** → แอดมิน org A เขียนสถานะห้อง org B ได้ (cross-org leak) | [_actions.ts:872](app/(admin)/rentspace/_actions.ts#L872) |
| C2 | actGenerateBillsForUnits ลืมเช็คสวิตช์ 'อนุญาตออกบิล' (billIssueUnlocked) ที่ฟังก์ชันพี่น้องมีครบ | [_actions.ts:1442](app/(admin)/rentspace/_actions.ts#L1442) |

### ธีม D · แก้/ถอนไม่ได้
| # | ปัญหา | ที่ |
|---|---|---|
| D1 | ไม่มีปุ่มถอน/แก้/ยกเลิก payment รายรายการ (paidAmount increment-only) → กรอกเกิน ฿100,000 แก้ไม่ได้นอกจากลบบิลทั้งใบ | [_actions.ts:1513](app/(admin)/rentspace/_actions.ts#L1513) |

### ธีม E · มิเตอร์
| # | ปัญหา | ที่ |
|---|---|---|
| E1 | ไม่มีเพดาน/เตือน typo เลขมิเตอร์ → พิมพ์ 12,000 แทน 1,300 = ค่าไฟ ฿75,600 เข้าบิลเงียบ | [meters/…/meter-board.tsx:227](app/(admin)/rentspace/meters/_components/meter-board.tsx#L227) |

### ธีม F · สัญญา ↔ งวดบิล
| # | ปัญหา | ที่ |
|---|---|---|
| F1 | ออกบิลไม่เช็คว่างวดอยู่ในช่วงสัญญา → คิดค่าเช่าเต็มเดือน "ก่อนเริ่มสัญญา" + ไม่ prorate เดือนสุดท้าย | [lib/rentspace/billing.ts:197](lib/rentspace/billing.ts#L197) |

### ธีม G · ลบข้อมูลหาย
| # | ปัญหา | ที่ |
|---|---|---|
| G1 | ลบสัญญาที่มีมัดจำ (แต่ยังไม่มีบิล) → cascade ลบประวัติมัดจำ ฿50,000 หายเงียบ (guard เช็คแค่ bills) | [_actions.ts:2319](app/(admin)/rentspace/_actions.ts#L2319) |

### ธีม H · นำเข้าข้อมูล (import)
| # | ปัญหา | ที่ |
|---|---|---|
| H1 | re-import ไฟล์ที่คอลัมน์ว่าง → เขียนทับผู้เช่าเดิม (เบอร์/อีเมล/ที่อยู่) ด้วยค่าว่าง | [api/rentspace/import/route.ts:277](app/api/rentspace/import/route.ts#L277) |
| H2 | import ไม่มีคอลัมน์ค่าเช่า → สร้างสัญญา active ค่าเช่า 0 → บิลอัตโนมัติเก็บ 0 บาท | [api/rentspace/import/route.ts:311](app/api/rentspace/import/route.ts#L311) |

### ธีม I · เชื่อมโยงบัญชี (คำถามหลักของ CEO)
| # | ปัญหา | ที่ |
|---|---|---|
| I1 | **บิล/ชำระ/มัดจำ/VAT ไม่โพสต์เข้า บัญชี-GL-TRCloud เลย** — RentSpace เป็นเกาะแยก (grep ทั้ง repo = 0 จุดเชื่อม) → รายได้ค่าเช่าไม่ลงสมุดบัญชี + ภาษีขายเสี่ยงยื่นขาด + เงินสดไม่ reconcile ธนาคาร | [lib/rentspace/billing.ts:423](lib/rentspace/billing.ts#L423) |
| I2 | คิด VAT + พิมพ์เลขผู้เสียภาษี 2 ฝ่าย แต่หัวเอกสารเป็น "ใบเสร็จ/ใบแจ้งหนี้" ไม่ใช่ "ใบกำกับภาษี" → ผู้เช่านิติบุคคลขอเครดิตภาษีซื้อไม่ได้ | [components/rentspace/bill-document.tsx:192](components/rentspace/bill-document.tsx#L192) |

---

## §3 🟢 P2 verified (5) — ควรแก้ ไม่ด่วน
- overdue: matrix/ใบบิลใช้ status เก่าใน DB แต่หน้ารายการคิดสด → บิลเดียวกันสีคนละหน้า — [matrix-grid.tsx:454](app/(admin)/rentspace/matrix/_components/matrix-grid.tsx#L454)
- การ์ด 'ค้างชำระรวม' โชว์ยอดแดงแต่ sub บอก 'ไม่มีค้างชำระ' (overdueCount นับ literal 'overdue' เท่านั้น) — [lib/rentspace/data.ts:348](lib/rentspace/data.ts#L348)
- ช่อง 'คาด' ใน matrix ใช้ค่าเช่าฐานห้อง ไม่ใช่ค่าเช่าตามสัญญาจริง — [matrix-grid.tsx:449](app/(admin)/rentspace/matrix/_components/matrix-grid.tsx#L449)
- actDeleteBill ลบบิลที่จ่ายแล้ว + ประวัติชำระ (ต้องเปิด unlock ก่อน) — [_actions.ts:1642](app/(admin)/rentspace/_actions.ts#L1642)
- ยืนยันสลิปผู้เช่า flip+increment แยก crash = จ่ายแล้วแต่ค้างตลอดกาล — [_actions.ts:2005](app/(admin)/rentspace/_actions.ts#L2005)

## §4 P2 อื่น ๆ (30 · unverified — จาก discovery ยังไม่ปรปักษ์)
เด่น ๆ: paidOn ใช้ UTC ไม่ใช่เวลาไทย ([collection-row.tsx:87](app/(admin)/rentspace/collections/_components/collection-row.tsx#L87)) · ทั้งโมดูลไม่มี error.tsx ([layout.tsx](app/(admin)/rentspace/layout.tsx)) · analytics นับ draft เป็นยอดออกบิล (matrix ไม่นับ) ([analytics.ts:41](lib/rentspace/analytics.ts#L41)) · actGetUnitDrawer เปิด PII ให้คนไม่มีสิทธิ์โมดูล ([_actions.ts:71](app/(admin)/rentspace/_actions.ts#L71)) · matrix_sort_order เป็น manual migration (ต้องยืนยัน apply prod) · รับชำระเกินยอดบิลไม่จำกัด/ไม่เตือน · ริบมัดจำ (forfeit) ไม่ลงรายได้ · settings เงินไม่มี validation. (ครบ 30 ข้อในผล workflow)

## §5 ❌ Refuted (ตรวจแล้วไม่ใช่บั๊ก · 1)
- "ล็อกมิเตอร์หลังออกบิล → เก็บค่าไฟ 2 เดือนรวด" — มิเตอร์เป็นค่าสะสม (cumulative) ยอดรวมออกมาถูกเสมอ ไม่มีเงินเพี้ยน

## §6 ❓ Uncertain (ต้องให้ CEO เคาะ · 1)
- Cron ออกบิลอัตโนมัติให้สัญญา 'หมดอายุ' ที่ยังเช่าต่อรายเดือน — [cron/rentspace-monthly-bills/route.ts:47](app/api/cron/rentspace-monthly-bills/route.ts#L47) — โค้ดตั้งใจข้าม expired แต่ธุรกิจอาจอยากให้ออกต่อ → เป็นดีไซน์หรือบั๊ก?

## §7 คำถามที่ต้องให้ CEO / นักบัญชีเคาะ (สรุปจาก 17)
1. **[ภาษี · สำคัญสุด] ค่าเช่าเป็น "เช่าอสังหาฯ (ยกเว้น VAT)" หรือ "บริการพื้นที่ (VAT 7%)"?** + น้ำ/ไฟบวก VAT ไหม → กระทบ default ทั้งระบบ + VAT ที่นำส่งสรรพากร (ตอนนี้ default = คิด VAT ค่าเช่า/ไม่คิดน้ำไฟ ซึ่ง**สลับด้าน**กับหลักภาษีเช่าอสังหาฯ ไทย)
2. **[บัญชี] RentSpace ควรส่งบิล/เงิน/VAT เข้าบัญชี/TRCloud อัตโนมัติ หรือคีย์มือแยกต่อไป?**
3. แก้เลขมิเตอร์งวดที่ออกบิลแล้ว → ให้บิลอัปเดตอัตโนมัติ หรือบังคับ "ยกเลิกบิลก่อนแก้"?
4. ต้องการปุ่ม "ยกเลิก/แก้ payment รายรายการ" (maker-checker) ไหม?
5. จ่ายเกินยอดบิล → เตือน/ห้าม หรือเก็บเป็นเครดิตยกงวดหน้า?
6. อนุมัติส่วนลด → บังคับคนละคนกับผู้ขอ หรือ admin อนุมัติเองได้?
7. import → สร้างสัญญา active อัตโนมัติจากแค่มีวันเริ่ม หรือบังคับตั้งค่าเช่าก่อน?

## §8 Sign-off
| เลนส์ | สถานะ |
|---|---|
| billing / FIN | 🟡 CONDITIONAL — P0-1 VAT snapshot ต้องแก้ + ถามโมเดล VAT |
| payment/deposit / OFC / AUD | 🔴 มี P1 หลายจุด (atomic tx, over-refund, ถอนไม่ได้) |
| actions / SEC | 🔴 cross-org (C1) + PII drawer (P2) |
| meter / BA | 🟡 typo cap (E1) + แก้ย้อนหลัง (B2) |
| integration / บัญชี | 🔴 เกาะแยก (I1) + ใบกำกับภาษี (I2) — รอ CEO ตัดสินทิศทาง |
| matrix/analytics / QA | 🟢 ตัวเลขไม่ตรงข้ามหน้า (P2 ส่วนใหญ่) |
| import | 🟡 H1/H2 |
| DEVIL | expiring dead-state, cron-expired (uncertain) |

## §9 ขั้นถัดไป
- **แก้ทันทีได้เลย (ไม่ต้องรอ policy):** ธีม A (atomic tx ×5) · C1 cross-org · C2 gate · D1 void payment · E1 meter cap · G1 delete guard · H1/H2 import guard → เฟส /bigsolvebug + adversarial money-verify ก่อน deploy
- **รอ CEO เคาะก่อนแก้:** P0-1 (โมเดล VAT) · I1/I2 (ทิศทางบัญชี) · B2 (มิเตอร์ย้อนหลัง) · cron-expired
- ทุกการแก้ money code → adversarial verify wave + CEO เทส live ก่อน (memory `money-feature-client-preview-must-match-server`, `verify-ui-fix-on-live-page-not-guess`)

---

## §12 Runtime crawl (READ-ONLY บน prod · 2026-08-07 · บัญชีเทส)
ไล่เปิดทุกหน้า RentSpace บน pooilgroup.com — **ทุกหน้าโหลดสะอาด ไม่มี 500/หน้าพัง/เมนูตัน** · console error = infra ล้วน (Sentry DSN, icon-192 404) ไม่มี error ฟังก์ชัน.

**✅ ยืนยัน config VAT จริงบน prod** (หน้า /rentspace/settings): "คิด VAT กับรายการไหน" → ☐ค่าเช่า (ไม่ติ๊ก) · ☑ค่าไฟ · ☑ค่าน้ำ — **ตรงกับ CEO decision เป๊ะ** → การแก้แค่ @default (ไม่แตะ row เดิม) ถูกต้อง.

**🔴 R1 (ใหม่ · data · money) — ค่าใช้จ่ายประจำ "ภาษีที่ดินและสิ่งปลูกสร้าง" ซ้ำ ~20 รายการ ระดับ "ทั้งโครงการ"**
- หน้า /rentspace/settings → การ์ด "ค่าใช้จ่ายประจำ (บวกทุกบิลอัตโนมัติ)" มีรายการ "ภาษีที่ดิน(และสิ่งปลูกสร้าง)" ซ้ำ ~20 แถว unitId=null (ทั้งโครงการ) · หลายอันมีเงินจริง: ฿117 (×5), ฿360 (×3), ฿234 (×2), ฿60, ฿40, ฿78 (ที่เหลือ ฿0)
- `buildBill` (lib/rentspace/billing.ts:269-292) วน recurring charge `isActive` แล้ว `if (amount===0) continue` → push เป็น item ทุกตัว **ไม่ dedup** → ทุกบิลที่ออกใหม่โดนบวกภาษีที่ดินซ้ำหลายรอบ (รวม ~฿2,400/บิล/ห้อง)
- น่าจะเป็น junk data จาก import/เพิ่มซ้ำ · **ไม่ใช่บั๊กโค้ด — เป็นข้อมูล** (audit โค้ดจึงมองไม่เห็น · เจอตอน runtime crawl)
- **แก้:** CEO ตรวจ + ลบรายการซ้ำในหน้าตั้งค่า (เหลือ 1 ต่อชนิด) · ผมไม่แตะเพราะเป็นการเขียน prod (ต้อง CEO สั่ง) · แนะนำเปิดบิลล่าสุด 1 ใบยืนยันว่ามีภาษีที่ดินซ้ำจริง

**หมายเหตุ:** การเทส "กดทุกปุ่มที่เขียน DB" ทำบน prod ไม่ได้ (บัญชีเทสห้ามบันทึกจริง) → จะเกิดตอน CEO เทส live หลัง deploy หรือถ้า CEO อยากให้เทสเต็มก่อน = ต้อง deploy ขึ้น preview ก่อน (ขออนุมัติ)

### §12.1 แก้ R1 (verify บนบิลจริง) — 2026-08-07
เปิดบิลจริง **A3/14 · INV202607000021** (บริษัท · ก.ค. 69): รายการ = ค่าเช่า ฿17,000 (ไม่มี VAT) · ค่าไฟ 766 หน่วย ฿5,362 (มี VAT) · ค่าน้ำ ฿0 · **ภาษีที่ดินและสิ่งปลูกสร้าง ฿78 (แค่ 1 บรรทัด!)**.
- ❌ **R1 ที่กลัวว่า "ทุกบิลโดนภาษีที่ดินซ้ำ ~20 รอบ" = ไม่จริง** — บิลจริงมีภาษีที่ดิน 1 บรรทัด. รายการซ้ำในหน้า settings ส่วนใหญ่ไม่ได้ไหลเข้าบิล (คาดว่า `isActive=false`). → **downgrade R1 เป็น: settings รก ควรจัดระเบียบ (data hygiene · ไม่เร่งด่วน · ไม่กระทบเงิน)**.
- ✅ **ยืนยันเครื่องคิดเงินถูกต้องบน live**: VAT model ตรง (ค่าเช่ายกเว้น/ค่าไฟคิด) · exempt-first ถูก: gross 22,440 − ส่วนลด 8,500 = subtotal 13,940 · vatableNet = ค่าไฟ 5,362 (ส่วนลด<ยอดยกเว้น จึงไม่กินฐาน VAT) · VAT 5,362×7% = ฿375.34 · รวม ฿14,315.34 — **ตรงกับที่ระบบโชว์เป๊ะทุกบาท**.

**สรุป runtime:** ทุกหน้าเปิดได้ · เครื่องคิดเงิน/VAT/ส่วนลดบน live ถูกต้อง (พิสูจน์กับบิลจริง) · ไม่เจอ money bug ใหม่ · R1 = false alarm (verify แก้แล้ว). การเทส write-path ที่เหลือรอ CEO deploy/อนุมัติเทส.

---

## §13 Team flow-test (นักบัญชี FIN เดินทุก flow · read-only · 2026-08-07)
> 6/7 persona ล่ม API ชั่วคราว · FIN ทำเต็ม — **ยืนยัน 14 fix ทำงานถูก end-to-end** (ออกบิล idempotent+VAT snapshot, รับชำระ/ถอน/มัดจำ atomic กัน drift/over-refund, มิเตอร์แก้ย้อนหลัง sync บิล, outstanding สูตรเดียวทุกหน้า) + เจอ **6 เรื่องใหม่**:

**✅ แก้แล้วทันที (round 2 · commit f4b6b6be):**
- 🟡 matrix โชว์สลิป pending + รายการ voided เป็น "ชำระ ✓" เขียว (ไม่ตรง paidAmount) → `matrix-data.ts` กรอง `status:'confirmed'`
- ต่อ **ปุ่มถอนการชำระใน UI** (D1 backend เดิมไม่มีปุ่ม) + หน้าบิล pending ติดป้าย "รอตรวจสลิป"

**⏳ P3 ค้าง — ต้อง CEO เคาะ (policy · ไม่ใช่บั๊กตรงไปตรงมา):**
- "เก็บได้เดือนนี้" 3 หน้าคนละฐาน (แดชบอร์ด/analytics = งวดบิล · หน้ารับชำระ = วันจ่าย) → เลือกนิยามเดียว (แนะนำ cash-basis ตามวันจ่าย)
- `actEditBillItems` audit log ไม่เก็บค่าก่อน/หลัง → เพิ่ม diff (audit trail เอกสารเงิน)
- ชำระรวมจ่ายเกินยอดค้าง → leftover ไม่ถูกบันทึก (unrecorded receipt) → เก็บเป็นเครดิต/กันจ่ายเกิน
- หัก/ริบมัดจำ ไม่ตัดยอดบิลที่ค้าง (เงิน 2 ก้อนไม่คุยกัน) → ผูก deduct กับบิลปลายทาง

---

## §14 Team flow-test 7/7 ครบ + DEPLOYED (2026-08-09)
ทีม 7 ที่นั่ง (PM·BA·QA·QC·STAFF·FIN·DEVIL) เดินทุก flow (J1–J7) บนโค้ดหลังแก้ — **ยืนยันตรงกัน: 18 fix ทำงานครบทุกเส้น money-safe ("ใช้ได้จริง")**. เจอเพิ่ม 2 P1 + 17 P2 + 19 P3.

**✅ แก้+deploy เพิ่ม (round 4 · setup `0b4f275f` · code-only):**
- P1 ปุ่มถอนการชำระขึ้นบนบิลจ่ายครบ (paid) — คีย์ผิดจนบิล paid ถอนได้แล้ว
- P2 พรีวิวออกบิลทั้งโครงการ = ใช้ computeBillTotals ตัวจริง (รวม VAT+ภาษีที่ดิน−ส่วนลด)

**⏳ ค้าง — รอ CEO เคาะ/ตัดสิน (policy หรือ UX ไม่เร่งด่วน):**
- P1 role 'member/staff' เห็นปุ่มบันทึกแต่กดแล้ว 'ไม่มีสิทธิ์' ทุกปุ่ม (ต้องตัดสิน role model: ให้เขียนได้ หรือซ่อนปุ่ม) — [_actions.ts:18]
- P2 หัก/ริบมัดจำไม่ผูกบิล · มัดจำในสัญญาไม่สร้าง ledger collect · cron ข้ามสัญญา expired (holdover) · import rent=0 · overdue ไม่มี cron flip · "เก็บได้เดือนนี้" 2 หน้าคนละฐาน · program_admin UI gate · slip-attach 2 path · (ครบใน workflow result)

**DEPLOY รวม:** `origin/setup 0b4f275f` (4 commit: 10b9b7df→97073d15→a3f1d81a→0b4f275f) + migration prod applied · verified tsc/build EXIT0 · money adversarial CLEAN · 20 fix.

---

## §15 CEO policy decisions → implemented + DEPLOYED (2026-08-09 · wave 3)
CEO ตอบ 4 คำถาม policy จาก team flow-test → แก้+deploy ครบ (`origin/setup 5f7ef2ce` · code-only):
- **Q1 สิทธิ์พนักงาน:** member จดมิเตอร์/รับเงินได้ (`gateModuleWrite`) · ลบ/void/อนุมัติ/มัดจำ/settings ยัง gateAdmin
- **Q2 "เก็บได้เดือนนี้":** cash-basis (Σ confirmed payment ตาม paidOn) — dashboard(data.ts)+analytics ตรงกับหน้ารับชำระ
- **Q3 หัก/ริบมัดจำ→ตัดบิล:** เลือกบิลค้าง → สร้าง payment(method=deposit)+ตัดยอดบิล+recompute ใน tx เดียว + UI dropdown
- **Q4 holdover:** cron ออกบิลสัญญา expired (เช่าต่อรายเดือน) · ตัดเฉพาะ terminated/draft

**รวม deploy 3 เวฟ:** a3f1d81a (18 fix+migration) → 0b4f275f (void-on-paid+preview) → 5f7ef2ce (4 policy) = **24 การแก้/ปรับปรุงขึ้น prod**. verified tsc/build EXIT0 ทุกเวฟ · money adversarial CLEAN · team 12-lens + 7-seat flow-test ยืนยันใช้ได้จริง.
