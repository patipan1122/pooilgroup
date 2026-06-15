# AUDIT — LedgerLine Bank Reconcile (กระทบยอดธนาคาร)

> /auditbigteam · 2026-06-15 · lens การเงิน (FIN+OFC+AUD) + SA+BA+Devil · read-only · adversarial-verified
> Money-Module Pre-Flight: snapshot ก่อน/หลัง เท่ากันทุกตาราง (agent ไม่เขียนอะไร)
> raw 18 findings → verify 16 → **confirmed 14 (P1×7 · P2×7) · dismissed 2**

## §1 Executive summary

CEO จับถูกทั้ง 2 จุด — แต่หลัง adversarial verify **ไม่มี P0** (ไม่มีเงินหาย/งบผิดตอนนี้) เพราะ:
- `ledger_revenue_entry.gl_state = NULL ทั้ง 197 แถว` → ชั้นนี้**ไม่ได้ post GL จริง** (TRCloud ถือ GL/VAT จริง) → เป็น "record ฝั่งกระทบยอด" ไม่ใช่งบการเงิน
- confirmed 43 กลุ่ม (บัญชี 0886) **delta = 0 ทั้งหมด** → ยังไม่มีเคส "ยืนยันทั้งที่ยอดไม่เท่า" เกิดจริง (latent ไม่ active)

แต่ **design เปิดช่อง** ให้ทำผิดได้ → ต้องแก้ก่อนใช้วงกว้าง/ก่อนเปิด GL posting.

## §2 ธีมหลัก 2 เรื่อง (ตามที่ CEO ห่วง)

### ธีม A — ส่วนต่างค่าธรรมเนียมไม่ถูกบันทึก ("ยอดไม่บาลานซ์") · P1
รวม finding: DEVIL-01, DEVIL-02, FIN-02, BA-C-01, BA-C-02

- **กลไก:** `createMatchGroupAction` คำนวณ `delta = bankTotal − bookTotal` เก็บใน `delta_satang` → แต่ `confirmGroupsInternal` **ไม่เคยอ่าน delta** (แค่ UPDATE match_state) + `confirmAllGroupsAction` ยืนยัน**ทุกกลุ่ม suggested ไม่มี gate delta**. ส่วนต่าง (ค่าธรรมเนียม/เงินขาด/เกิน) **ไม่ถูก booking ที่ใด**.
- **ต้นเหตุลึก:** ฝั่งส่ง net = gross − fee%**ตายตัว** (Grab 16/Shopee 16/Lineman 18) แต่ fee จริงแกว่ง → matcher เผื่อ tolerance (Grab 3%/Shopee 5%) → ส่วนต่าง "ถูกกลืน" แทนที่จะ "ถูกจับมาตรวจ" (lesson `net-vs-gross-into-reconcile`).
- **มุมบัญชี:** reconcile ที่ยอม delta≠0 ต้องเคลียร์ปลายทางเสมอ — ค่าธรรมเนียม (5210x) / WHT / suspense. ปล่อย delta ลอย = false-green ทางการเงิน.
- **ทำไมไม่ P0:** UI โชว์ delta เด่น (badge "ต่างกัน ฿X" อำพัน + modal เตือน) → maker เห็นก่อนกด · ไม่ post GL จริง · ยังไม่เคยเกิด (43 confirmed delta=0).
- **⚠️ DISMISSED ที่เกี่ยว:** "ส่ง net = ผิดราก/เสียภาษี" → **ถูก dismiss** เพราะ Grab/Shopee **โอน net จริง** (หักคอมต้นทาง) → ส่ง net ถูกต้องสำหรับ matching; ปัญหาคือ **% เดา** ไม่ใช่วิธี net. และ input-VAT ค่าคอม claim ผ่าน AP/TRCloud path แยก (พิสูจน์จาก repo นี้ไม่ได้ว่าเสียสิทธิ์).

### ธีม B — เงินสด grain ผิด ("เงินสดหาคู่ไม่เจอ") · P1
รวม finding: SA-B-01, SA-B-02, SA-B-03

- **กลไก:** ฝั่งบัญชีส่งเงินสด = **"ยอดขายสด POS รายวัน" (1/วัน)** ไม่ใช่ **"ยอดนำฝากจริง"**. ฝั่งธนาคาร 0886 = ฝากเป็นก้อน 242 ใบ คนละรอบ/คนละจำนวน/ปนธุรกิจ (ลูกชิ้น+อเมซอน). matcher จับ 1:1 ±฿1 → โอกาสตรงเป๊ะ≈0 → **225/242 ใบ ค้าง unmatched เป็นระบบ**.
- **มุมบัญชี:** มาตรฐาน reconcile เงินสด = **deposit slip ↔ statement** (POS↔cash-count เป็นชั้นแยก). ยัด POS-cash เข้า bank-recon ตรง ๆ = ข้าม cash-in-transit → เงินที่ยังไม่ฝาก/ฝากข้ามวัน กลายเป็น "ส่วนต่างถาวร".
- **ขาด N:M auto:** auto-match ทำแค่ 1:1 — ไม่มี subset-sum (รวมหลายวัน = 1 ก้อนฝาก). N:M เป็น manual ล้วน → ช้า/ตกหล่น + เปิดช่อง "จับมั่วให้ยอดตรง".
- **บัญชีปนธุรกิจ:** 0886 รับเงินลูกชิ้น+อเมซอน แต่ฝั่ง bank ไม่มี tag แยกธุรกิจ → ใบฝากลูกชิ้นไม่มี book มาจับ (ค้างถาวร) หรือถูกเงินสดอเมซอนจับข้าม. ขัดกฎ CEO เดิม **"1 บัญชี = 1 ธุรกิจ"** [[cashhub-reconcile-send-by-account-1to1-2026-06-15]].

## §3 P2 (design-debt · แก้ก่อน scale/เปิด GL)
- SA-C-03: auto-match ไม่มี ambiguity guard (book ≥2 ตัวเข้าเกณฑ์ → ควรปล่อย suggested ไม่ auto) — บัญชีปนธุรกิจ+ยอดใกล้+tol กว้าง = เสี่ยงจับผิดคู่.
- FIN-03: CASHHUB_AMAZON ไม่ stamp gl_account/gl_state (path อื่น stamp) → เปิด GL เมื่อไหร่ CashHub ถูกข้ามเงียบ.
- FIN-04: ค่าคอม + VAT/WHT บนค่าคอมไม่มี line item (เมื่อทำ booking fee ให้แตก 3 ส่วน).
- FIN-05: 2 ทางป้อนรายได้ (TRCloud IV gross vs CashHub net) ไม่มี guard กันนับซ้ำ company+งวดเดียวกัน.
- BA-C-02: fee%ตายตัว vs tolerance ชน → เกิน tol=ค้าง / ในกรอบ=delta ลอย.
- learn-on-confirm จำคีย์จากกลุ่ม delta≠0 ได้ (เรียนรู้คู่ที่ตรงโดยบังเอิญ) → ควร learn เฉพาะ delta=0.
- "กระทบยอดแล้ว" = สถานะหน้าจอ (gl_state NULL · gl_fee config ไม่เคยถูกใช้).

## §4 Recommendation (spec เท่านั้น — ห้ามแก้ money pipeline เอง · CEO+นักบัญชีเคาะ)

**ธีม A:**
1. `confirmAllGroupsAction` confirm อัตโนมัติ **เฉพาะกลุ่ม delta=0**. กลุ่ม delta≠0 ห้าม bulk → บังคับเปิดทีละกลุ่ม ระบุปลายทางส่วนต่าง (ค่าธรรมเนียม/WHT/suspense) ก่อน confirm.
2. ฐานที่แม่นกว่า (CEO เลือก): **(A) ดึง payout/settlement report ของ Grab/Shopee/Lineman (net จริง+fee จริง) เป็น book** → tol เหลือ ±฿1 · หรือ **(B) book=gross, bank=net, ส่วนต่าง→booking เป็น fee expense อัตโนมัติตอน confirm** (ใช้ gl_fee ที่มีอยู่แล้ว).

**ธีม B:**
3. เงินสด: เปลี่ยน book จาก "ยอดขายสด" → **"ยอดนำฝาก"** (ถ้าไม่มีข้อมูลฝาก ใช้ cash-on-hand clearing). reconcile POS-cash↔cash-count แยกชั้น.
4. เพิ่ม **N:M subset-sum suggester** สำหรับเงินสด (เสนอชุดวันที่รวม = ยอดฝาก ให้คนยืนยัน).
5. **1 บัญชี = 1 ธุรกิจ** (CEO เคยเคาะ) — แยก 0886 เป็นลูกชิ้น/อเมซอน · หรือ tag ธุรกิจฝั่ง bank txn ก่อน reconcile.

## §5 🎯 Top decisions ต้อง CEO เคาะ
1. **ฐานค่าธรรมเนียม:** ดึง payout report แพลตฟอร์ม (A · แม่นสุด) vs book gross+fee expense (B) vs คงเดา%+บังคับ booking delta. → กระทบทุกแพลตฟอร์ม
2. **gate confirm delta≠0:** บังคับระบุปลายทางส่วนต่างก่อนปิด (maker-checker) — ใช่ไหม?
3. **เงินสด:** ใช้ "ยอดนำฝาก" แทน "ยอดขายสด" + ทำ N:M subset-sum — ใช่ไหม?
4. **1 บัญชี = 1 ธุรกิจ:** แยก 0886 หรือ tag ธุรกิจฝั่ง bank?
5. **redeem/AIS/TRUE + AMZ_SD:** ส่งเข้า reconcile แบบรอบไหน (ค้างจาก discovery เดิม)

## §6 Sign-off
| Lens | Status | หมายเหตุ |
|---|---|---|
| FIN/OFC/AUD | 🟡 CONDITIONAL | ธีม A+B แก้ก่อน scale · วันนี้ยังไม่มีเงินหาย (GL=TRCloud) |
| SA/BA | 🟡 CONDITIONAL | cash grain + N:M + บัญชีปนธุรกิจ |
| Devil | ⚠ OBJECTS-BUT-ACCEPTS | เดา fee% เปราะ · ทางถูก=payout report |

> ทั้งหมด = **spec** · ห้าม auto-fix money path · รอ CEO+นักบัญชีอนุมัติ design ก่อน build.
