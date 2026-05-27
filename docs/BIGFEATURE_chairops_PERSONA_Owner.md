# Persona: Owner (CEO mock) — ChairOps /bigfeature roundtable

> Voice: Pattipan, CEO, 3 SME businesses, non-technical, Thai-first
> Date: 2026-05-27 · Run #1

---

## Strategic fit

ผมมี 3 ธุรกิจ — Pooil (น้ำมัน · ใหญ่สุด · จ่ายเงินเดือนทีม) · ChairOps (เก้าอี้นวด · ~100 ตัว · อนาคต 1,200) · Playland (สวนสนุก · พึ่งเริ่ม). Pool ERP คือเครื่องมือกลางที่ใช้กับทั้ง 3.

ChairOps now เพราะ — Pooil อยู่ตัวแล้ว · Playland ติดรอเครื่อง ACS · ChairOps คาราคาซังที่สุด 30 LINE group แม่บ้านส่งรูปมั่ว · เงินขาดสะสมแบบไม่รู้ตัว · บัญชี import เดือนแรกยังไม่ได้. ปล่อยต่อไป **ผมเสียเงินจริงทุกวัน** ไม่ใช่เสีย opportunity cost.

อีกข้อ — ถ้า ChairOps ทำได้ครบจริง · ผม **ขยายเป็น 1,200 เก้าอี้ตามที่ฝัน** ได้โดยไม่ต้องจ้าง office staff เพิ่ม. ROI ตรงนี้ใหญ่กว่าทุกโมดูล.

---

## What I'm REALLY worried about

1. **ผมเป็นคน reconcile คนเดียว** — แผนบอกไม่มี MGR_AREA · มี office 1-2 คน. ถ้าผมป่วย 1 อาทิตย์ · เงินขาดสะสมจะระเบิดไหม? ระบบต้อง **alert ใครได้บ้างนอกจากผม**?

2. **AI parse บิลห้างผิด แล้วผม approve มั่ว** — 30 สาขา × 1 บิล/เดือน = 30 บิล. ผมจะมีเวลาเช็คทุกบิลจริงหรือ? วันที่ขี้เกียจ ผมกด APPROVE รัวๆ บัญชีเดือนนั้นเพี้ยน · ต้องรีไฟต์ก่อน hard-close. **น่ากลัวกว่าที่คิด.**

3. **แม่บ้าน 30 คนใช้ LINE OA ไม่เป็น** — แม่บ้านบางคนอายุ 50+ · LINE group ปกติยังพิมพ์ผิดเลย. LIFF Mini App + rich menu จะทำให้เขางง · กลับมาส่งใน group เดิม · เราเสียเงินทำระบบเปล่า.

4. **15-21 วันจะกลายเป็น 30-40 วัน** — ทุก project โตเกิน 1.5x. Wave 1 ติด LINE OA verify อาจ 2 อาทิตย์เพิ่ม (ผมเคยทำ OA Pooil · BotNoi ตอบช้า). ระหว่างนั้น ChairOps live อยู่บน prod ครึ่งใบ.

5. **เงิน security deposit ที่ห้าง** — ผมจำได้ไม่ครบ! บางห้างผมจ่ายไปตั้งแต่ปี 2566 · บางห้าง 5 หมื่น · บางห้าง 1.5 แสน · ตอนนี้อยู่ใน Excel ลับของผมไฟล์เดียว ลูกน้องไม่เห็น. ถ้าเข้าระบบ · ใครเห็นได้บ้าง? ผม **ไม่อยากให้ office staff เห็นยอด deposit รวม** (เป็นสินทรัพย์จมที่ผมใช้ต่อรองห้าง).

---

## Cost vs revenue gut check

ต้นทุนพัฒนา: 15-21 วัน Claude + ผมรีวิว. ผมไม่ได้จ่าย dev เป็นเงินเดือน · cost จริง = opportunity cost ของเวลาผม + ค่า Claude API (~3-5k บาท/อาทิตย์ตอน build เข้มข้น).

ฝั่งรายได้/เซฟ:
- **เงินขาดสะสม** ตอนนี้ผมเดาว่าหายไปประมาณ 5-15k/เดือน (สาขาขาดเฉลี่ย 200-500 บาท × 30 สาขา). 1 ปี = 60-180k. ลดได้ครึ่ง = **เซฟ 30-90k/ปี.**
- **เวลาผม reconcile** ปัจจุบันใช้ 2-3 ชม/วัน × 30 วัน = 60-90 ชม/เดือน. ถ้าลดเป็น 30 นาที/วัน = เซฟ ~50 ชม/เดือน × 12 = **600 ชม/ปี.** เวลานี้เอาไปขยาย Pooil/Playland ได้.
- **บัญชี import** ตอนนี้จ้าง outsource accountant 8k/เดือน + re-key. ถ้า import auto = **เซฟ 4-5k/เดือน × 12 = 48-60k/ปี.**
- **ขยายเป็น 1,200 เก้าอี้** — ถ้าระบบรองรับ · ผมไม่ต้องจ้าง office +2 คนตอนสเกล · เซฟเงินเดือน ~50k/เดือน

รวมประมาณ: **เซฟ 200-300k/ปี + เวลาผม 600 ชม.** Payback period < 2 เดือน. **ทำคุ้ม.**

---

## Time-to-market concern

Wave 0 (3-4 วัน) — ผมรอได้ · ปิด risk + upload XLSX ใช้ได้ · win เร็ว
Wave 1 (5-7 วัน) — **ติด LINE OA verify** (1-3 วัน external · ผมต้องไปสมัคร business account · ส่งเอกสารบริษัท). อาจกลายเป็น 10 วัน
Wave 2 (4-6 วัน) — Gmail OAuth ผมต้อง grant ครั้งเดียว · ไม่กังวล
Wave 3 (3-4 วัน) — polish · ตัดได้ถ้าจำเป็น

**Pilot 1 branch** — เร็วสุด end of Wave 1 ~วันที่ 14-17 จากนี้. **ผมรอได้.**

**Full 30 สาขา** — End of Wave 1 + 1 อาทิตย์ training = ~25-30 วันจากนี้. ตรงกับสิ้นเดือนพอดี · บัญชีเดือนพฤษภาเริ่มใช้ระบบใหม่ทันก่อน close. **ผมยอมรับ timeline นี้** แต่ขอ Claude อย่าหายไป 3 วัน mid-wave.

---

## Brand concern

Pool ERP ผมอยากให้ดู "**SME tool พรีเมียม · เหมือน Linear กับ Notion เวอร์ชั่นไทย**" — ไม่ใช่ tool หาง่ายตามตลาด.

ChairOps wave plan ใช้ brand blue เดียวกับ Pool · sticky thead · solid bg · ไม่ uppercase Thai = OK · consistent.

สิ่งที่กังวล: **LIFF Mini App design ของ ChairOps จะหลุดจาก Pool brand** เพราะอยู่ใน LINE. ขอ Claude ระวัง — LIFF rich menu ต้อง custom asset · ไม่ใช่ default LINE icon · ทั้ง 4 menu items (เก็บเงิน · ตรวจคลีน · แจ้งซ่อม · เบิกของ) ต้องดู **brand-consistent กับ Pool admin web**

---

## What I'd cut to ship faster

ถ้าต้องตัด 30%:

1. **Wave 3 polish ทั้งหมด** — leaderboard · sparkline · LINE OA push templates. เก็บไว้ทำหลัง production-ready. cut ~3-4 วัน
2. **MANAGER_AREA helper** (Wave 1.5) — ไม่มี user ตอนนี้ · ไม่ทำเลยก็ได้ · ค่อยใส่ตอนจ้าง area manager จริง. cut ~0.5 วัน
3. **Offline outbox v1 (IndexedDB) for maid PWA** — แม่บ้านส่งงานออนไลน์เป็นหลัก · WiFi ห้างหลุดบ้างแต่ไม่บ่อย. ทำ retry-on-reconnect ก็พอ · ไม่ต้อง full offline. cut ~1-2 วัน
4. **Damage SLA cron + spare parts movement ledger** (Wave 3.2) — ตอนนี้ damage ticket 1-2 ใบ/อาทิตย์ · ผม track ได้ใน Excel. cut ~1 วัน

รวมตัดได้ ~6-7 วัน · จาก 15-21 → 9-14 วัน. **เร็วขึ้นเกือบครึ่ง.** แต่ผมไม่จำเป็นต้องตัด · เวลามี · ของให้ครบดีกว่า

---

## What's NOT in the plan that I want

1. **ผู้รับ alert สำรองนอกจาก CEO** — เวลาผมป่วย/นอกประเทศ · alert "เงินขาด 5000" ต้องถึง office staff ด้วย · ไม่ใช่หายเข้า void
2. **ห้องลับ deposit field** — securityDeposit ต้องมองเห็นได้แค่ admin tier (org_admin/super_admin) · ไม่ใช่ office. กรองออกจาก default branch view
3. **Mobile PWA ฝั่ง CEO** — ผมเดินทางบ่อย · อยากเปิด /chairops/dashboard ใน iPhone แล้วเห็น KPI 5 ตัว + alert ของวันนั้น. ไม่ต้อง full admin
4. **Backup ก่อน hard-close** — ก่อนกด period hard-close · ระบบควร snapshot ทุก table เก็บไว้ · กันผม fat-finger เผลอ
5. **Export ทั้ง history** — บางวันผมอยาก export ChairOps audit log 6 เดือนย้อนหลังไป Excel review · ตอนนี้ Wave 3.1 มี audit page filter แต่ไม่แน่ใจ export ดิบทั้งหมดได้ไหม

---

## Decision

**GO ahead Wave 0 ทันทีวันนี้.**

เหตุผล:
- Wave 0 ปิด 5 critical risks ที่ live บน prod อยู่ · ทำก่อนคืนนี้ไม่ผิด
- XLSX upload flow ผมต้องได้ใช้เร็วที่สุด (เดือนนี้บัญชี import ยังพึ่ง re-key)
- Cost low · risk low · win เร็ว

**Wave 1 รอ checkpoint** — หลัง Wave 0 ผมเช็ค output 2-3 ชม · ค่อยเปิดไฟเขียว LINE OA setup. ระหว่างนั้นผมไปสมัคร LINE OA business account ก่อน (parallel)

**Pre-commit ต้องตอบก่อน:**
- [ ] securityDeposit field ใครเห็นได้ — ขอ admin-only
- [ ] Alert routing — ขอ secondary recipient slot ใส่ตอน Wave 0 schema เลย ไม่ต้องรอ Wave 3
- [ ] LIFF rich menu — ขอเห็น mockup ก่อนสร้าง · ไม่ใช่หลังสร้างเสร็จ

**ลุย Wave 0 ได้เลย. ผมรออ่าน briefing.**
