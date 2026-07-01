# ULTRAREVIEW — ClawOS (ตู้คีบ OS) · 2026-07-01

> วิธีทำ: Workflow 33 agents · 3.0M subagent tokens · โค้ดที่รีวิว = origin/setup (deploy จริง · worktree clawos-wt @73b3dd16, git diff clawfleet vs origin/setup = ว่าง)
> 3 เลนส์ซ้อนกัน: (1) ผู้ใช้จริง 8 บทบาทลองใช้บนหน้าจอที่ ship จริง + ให้คะแนน + สัมภาษณ์  (2) /review code 6 เลนส์  (3) /impeccable
> ทุก code finding ผ่านการตรวจปรปักษ์ (skeptic เปิดโค้ดหักล้างก่อนนับ) → ยืนยัน 13 · ตกรอบ 2 (dead code / ทิศทางผิด)
> **คะแนนพึงพอใจเฉลี่ย = 5.7 / 10**

---

## 1. ตารางคะแนนผู้ใช้จริง (satisfaction scoreboard)

| บทบาท | คะแนน | จะใช้ต่อไหม | ประโยคเด็ด (สัมภาษณ์) |
|---|---|---|---|
| แอดมินส่วนกลาง HQ | **7.0** | ใช้ต่อ | "แกนงานหลัก—อนุมัติราคา+ส่งของพร้อมต้นทุน—ทำจริงและกันของหลอกได้ดีกว่าที่คาด แต่สวิตช์นโยบายที่ตายต้องรีบแก้" |
| ผู้จัดการสาขา | **6.5** | ใช้ต่อ | "ได้ศาลกันโกงในจอเดียว...แต่ยังไม่เชื่อ 100% ว่า 'ไม่โชว์=ปกติ' จนกว่าจะแก้ collections + ปิดช่องเงินเกิน" |
| แม่บ้านเก็บเหรียญ | **6.0** | ใช้ต่อ | "ใช้ได้และเข้าใจงานหน้างานกว่าที่คิด แต่พอเน็ตห้างตกต้องยืนถ่ายรูปซ้ำ 3 รอบ ตอนเจอตู้มิเตอร์ดับก็ติดตายปิดรอบไม่ได้" |
| พนักงานคลัง/DC | **6.0** | ใช้ต่อ | "แกนหลัง (ledger, ทุนเฉลี่ย, กันรับซ้ำ) แน่น แต่จะบ่นเรื่องบาร์โค้ด+นับตาบอดทุกวันจนกว่าจะแก้" |
| ผู้ตรวจสอบภายใน | **6.0** | ใช้ต่อ | "เก่งกันโกง 'ตอนนี้' แต่พิสูจน์ 'เมื่อวาน' ไม่ได้—ไม่มี audit_logs ยังต้องพึ่ง dev query DB" |
| เจ้าของกิจการ | **5.5** | ใช้ต่อ (ระแวง) | "พอจับได้ว่า 'รายได้ 7 วัน' จริงๆ เป็นแค่วันนี้ และกราฟกำไรปลอมได้ ผมเลิกเชื่อจอทันที ต้องโทรถามลูกน้องยืนยัน" |
| นักบัญชี/ปิดงบ | **5.5** | ใช้ควบคู่ | "เป็น 'ระบบหน้างานที่ดี' แต่ยังไม่ใช่ 'ระบบปิดบัญชี'—ไม่มี export + หน้ากระทบยอดโชว์แค่รอบ anomaly" |
| ช่างซ่อม | **3.0** | ยังไม่ใช้ | "สำหรับงานช่างมันยังเป็นแค่จอดูสวยๆ...ถ้าแจ้งซ่อมได้จริง+ปรับมิเตอร์หลังซ่อมได้ ผมจะใช้ทุกวันทันที" |

**อ่านคะแนน:** HQ/ผจ.สาขาพอใจสุด (แกนกันโกงตอบโจทย์เขา) · เจ้าของ/นักบัญชีกลางๆ (เชื่อตัวเลขไม่ได้ + ปิดบัญชีไม่จบ) · **ช่างซ่อมตกเหว 3.0** เพราะ role จริง = viewer และงานช่างทุกอย่างเป็น mock

---

## 2. ธีมร่วม (patterns ที่ผู้ใช้หลายคนชนตรงกัน — สำคัญสุด)

### T1 · "หลอกตา" — ข้อมูลตัวอย่าง (SAMPLE/mock) โผล่ปนของจริงโดยไม่มีป้าย  ⭐ ธีมใหญ่สุด
ผู้ใช้ 5 คนใน 8 ชนเรื่องนี้ · เป็น class เดียวกับที่ owner-critic เคยจับได้ก่อนหน้า **ยังหลุดเหลือในบางจุด**:
- เจ้าของ: กราฟกำไรรายวัน fallback เป็น SAMPLE_DAYS (฿24k–35k ปลอม) เมื่อ 7 วันไม่มีรอบปิด — ไม่เช็ค hasRealData → **จอที่เจ้าของดูเป็นอย่างแรกทุกเช้าโชว์เลขปลอม**
- คลัง: ตารางสต๊อกรายสาขาเอาของจริงแค่สาขาแรก สาขา 2+ เป็นเลขตัวอย่างแปะชื่อสาขาจริง (ไม่มีป้าย)
- แม่บ้าน: เมนูลัด 4 ปุ่ม + ทัวร์เติมตู้ = mock ล้วน (บางอันมีป้าย ComingSoon บางอันไม่มี)
- ผจก./นักบัญชี: การ์ด "ตรงกัน X รอบ / ตู้เสีย" ในหน้า collections เติมได้แค่ตอน sample

### T2 · หน้ากระทบยอด collections โชว์ "แค่รอบผิดปกติ" แต่ทำเหมือน "ทุกรอบ"
ผจก.สาขา + นักบัญชี ชนตรงกัน (ทั้งคู่ให้ P0) — `listV2Anomalies` ดึงเฉพาะ `status='ANOMALY_REVIEW'` แต่ UI มีแท็บ "ทั้งหมด/ตรงกัน/ไม่ตรง/ตู้เสีย" + การ์ดสรุป → เข้าใจผิดว่า "เมื่อวานเก็บ 2 รอบ" ทั้งที่เก็บ 40 โชว์แค่ 2 ที่ผิด · **นักบัญชี tie ยอดทั้งเดือนไม่ได้**

### T3 · "เงินเกิน" ไม่ถูกจับ (รูรั่วกันโกง)
ผจก. (P0) + นักบัญชี (P1) — `gap = Math.max(0, expected − actual)` ปัดเงินเกินเป็น 0 → รอบที่นับเงินได้ "มากกว่า" มิเตอร์ (สัญญาณมิเตอร์ถูกงัด/นับสลับตู้/ชดเชยรอบก่อน) ถูกจัดเป็น "ตรงกัน" เงียบๆ

### T4 · พิสูจน์ย้อนหลัง/ปิดบัญชีไม่ได้
ผู้ตรวจสอบ (P0 ไม่มี audit_logs) + นักบัญชี (P0 ไม่มี export CSV) — ระบบกันโกง "ตอนเกิด" ดี แต่ไม่ทิ้ง immutable trail + export เข้า workbook ไม่ได้

### T5 · ช่างซ่อมไม่มีที่ยืนในระบบ
แจ้งซ่อมจริงไม่ได้ (mock) + rebaseline มิเตอร์หลังซ่อมไม่ได้ → **ช่างโดนกล่าวหาโกงหลังเปลี่ยนมิเตอร์** (เลขกลับเป็น 0 → รอบถัดไปขึ้นธง "เงินขาด")

---

## 3. รายการต้องแก้ (🔴 ต้องแก้ · 🟡 ควรแก้ · 🟢 ดีแล้ว)

### 🔴 ต้องแก้ — กระทบเงิน / ความเชื่อถือจอ / กันโกง

| # | ปัญหา | ที่ (file:line) | ใครเจ็บ | แก้ |
|---|---|---|---|---|
| R1 | กราฟ dashboard เด้ง SAMPLE ปลอมแม้ org จริง (ไม่เช็ค hasRealData) | `dashboard-client.tsx:77` | เจ้าของ P0 | gate ด้วย hasRealData เหมือน branches/alerts—org จริงโชว์ ฿0 + "ยังไม่มีรอบเก็บ" |
| R2 | KPI "รายได้ (7 วัน)" จริงๆ ดึงแค่วันนี้ (getBranchPnl ไม่ส่ง range) — เลข KPI ≠ กราฟ | `pnl-queries.ts:122-128` + `dashboard/page.tsx:43` + label `dashboard-client.tsx:109,157` | เจ้าของ P0 | ส่ง range 7 วันให้ตรงกราฟ+ป้าย หรือแก้ป้ายเป็น "วันนี้" |
| R3 | collections โหลดแค่ ANOMALY_REVIEW แต่ทำเหมือนทุกรอบ | `queries.ts:171-179` | ผจก.+นักบัญชี P0 | ดึง CLOSED_STATUSES ทั้งช่วง แล้วจัด 4 แท็บจากชุดเต็ม |
| R4 | "เงินเกิน" ถูกปัดเป็น 0 ไม่เข้า anomaly | `queries.ts:197,266` | ผจก.+นักบัญชี | ใช้ absGap + เก็บทิศทาง (ขาด/เกิน) เงินเกินเกินเกณฑ์ → ANOMALY_REVIEW |
| R5 | บัญชี "viewer" เขียนสต๊อก+ตั้งราคาได้ทุกสาขา (6 action ไม่มี role guard) | `role-guard.ts:67` + `stock-actions.ts:133,698,757,820,925` + `actions.ts:718` | code P1 (authz) | ใส่ `canWriteOff(role)` guard ต้นทุก write action (mirror recordLoss) |
| R6 | ช่างซ่อม: rebaseline มิเตอร์หลังซ่อมไม่ได้ → โดนหาว่าโกง + แจ้งซ่อมเป็น mock | `actions.ts:520` (ไม่มี recalibrate) + `staff-app-client.tsx:944-977` | ช่าง P0×2 | action `recalibrateMeter` (ช่าง+ผจก · maker-checker ฿0) + RepairPanel จริง (cf_repair_log + isActive) |
| R7 | ไม่เขียน audit_logs เลย (ตาราง `auditLog` มีอยู่ schema.prisma:632 · 0 call site ใน clawfleet) | `lib/clawfleet/*.ts` | ผู้ตรวจสอบ P0 | append-only log ในทุก sensitive action (review/loss/config-approve) ในทรานแซกชันเดียว |
| R8 | ไม่มี export CSV/Excel ทั้งโมดูล — ปิดบัญชีไม่จบ | ทั้ง reports/collections/stock | นักบัญชี P0 | ปุ่มดาวน์โหลด CSV: reconcile ทุกรอบ + P&L รายสาขา + ledger สต๊อก + ใบตัดของเสีย |

### 🟡 ควรแก้ — ทำงานหน้างานฝืด / correctness ที่ verify แล้ว

**มือถือแม่บ้าน (P0-P1 ของแม่บ้าน แต่จัด 🟡 เชิงระบบ):**
- รูปไม่มี offline queue → เน็ตห้างตกต้องยืนถ่ายซ้ำ (`photo-capture-button.tsx:43-56` + `staff-app-client.tsx:1275`) → เก็บ blob ลง IndexedDB retry เบื้องหลัง เหมือน draft
- ลิสต์ตู้ = ทุกสาขาที่มีสิทธิ์ ไม่ใช่ตู้ที่ assign วันนี้ + progress "0/18" นับจาก draft (กดเสร็จเลขไม่ขยับ) (`os/app/page.tsx` + `staff-app-client.tsx:72-92,651-654`)
- ไม่มีปุ่ม "ตู้เสีย/ข้ามตู้" ใน wizard → มิเตอร์ดับ = ติดตายปิดรอบไม่ได้ (`staff-app-client.tsx:448-458,944-978`)

**HQ:**
- 3/4 สวิตช์นโยบาย (meterMatch/cashAlert/lockConfig) เป็นสวิตช์ตาย — บันทึก DB แต่ 0 reader → false confidence (`policy.ts:18-45`, อ่านแค่ photoRequired) → wire จริง หรือติดป้าย "เร็วๆนี้"+disable
- ตีกลับคำขอปรับราคาไม่มีช่องเหตุผล (backend รับ note param 2 อยู่แล้ว) (`config-client.tsx:285`)

**คลัง:**
- ปืนยิงบาร์โค้ดใช้ไม่ได้ (backend `lookupCfProductByBarcode` พร้อม · 0 caller ใน .tsx) (`stock-actions.ts:73` · `stock-client.tsx:819`)
- ฟอร์มนับสต๊อกไม่โชว์ยอดระบบ → นับตาบอด นิ้วพลาด 380 แทน 38 = ปรับ +342 ทันที (`stock-client.tsx:1126`)

**Code races/correctness (verify แล้ว):**
- อนุมัติคำขอปรับราคา 2 ครั้งพร้อมกัน → loadout ราคาซ้อน 2 ชุด (ตัวหารกันโกงเพี้ยน) `config-requests.ts:180,200` → atomic claim updateMany (mirror reviewCfLoss)
- โอน/เบิกสต๊อกพร้อมกัน → สต๊อกติดลบ (ไม่มี advisory lock ฝั่ง out) `stock-actions.ts:715,771`
- reviewV2Session ไม่มี status guard → อนุมัติ/recheck รอบ LOCKED ซ้ำได้ ทับ audit `actions.ts:83-91`
- ตู้แลก (token group) เงินสดไม่เคยถูกกระทบยอด (expected=0 เสมอ) `actions.ts:640-664` + `validation.ts:225-254`

**เจ้าของ/นักบัญชี (analytics):**
- ไม่มี KPI "เมื่อวาน/วันนี้" เดี่ยว (มีข้อมูลใน getDailyPnl แล้ว) `dashboard-client.tsx:107-118`
- ตาราง "คุณภาพพนักงาน" เรียงตามชื่อ ไม่ดันคนน่าสงสัยขึ้นบน `reports/page.tsx:50-68`
- reports read-only คลิกเจาะต่อไม่ได้
- มูลค่าสต๊อกใช้ต้นทุนวันนี้ ไม่มี snapshot as-of วันปิดงวด `stock-queries.ts:191`
- staff metric หน้า reports (มีเลข) ≠ หน้า staff ('—') `reports/page.tsx:57-66`

### 🟢 ดีอยู่แล้ว (ผู้ใช้ชมเอง — อย่าไปแตะ)
- ปุ่ม "ถ่ายไว้ก่อน กรอกเลขทีหลัง (ในที่ร่ม)" — แม่บ้านรัก (แสงมืดหน้าตู้)
- ช่องตัวเลขว่างจริง + บังคับกรอกครบก่อนไปต่อ (กันเงินขาดโดนหักเอง)
- draft รอด refresh/ปิดแอป (localStorage)
- รูปจริงต่อตู้ + lightbox เต็มจอ — ผจก.ใช้ตัดสินจริง
- Segregation of duties จริง: อนุมัติรอบตัวเองไม่ได้ + role guard (auditor ชม 2 ด่าน)
- maker-checker ตัดของเสีย ฿500 → PENDING ไม่ตัดสต๊อกจนอนุมัติ (นักบัญชี+auditor ชม)
- weighted-avg cost + pg_advisory_xact_lock กัน lost-update (นักบัญชี+คลัง ชม)
- ledger สต๊อก signed qty ผูก refTable/refId
- config approve ทำจริง + rollback ถ้าตู้ไม่มีราคาตั้งต้น (HQ ชม)
- createShipment บังคับราคาขาย+ทุน >0 + ตรวจรับกันกดซ้ำ atomic (HQ+คลัง ชม)
- retention รูปแยกตามความเสี่ยง (CLOSED 30d / LOCKED 180d) (auditor ชม)
- cron ไม่ปิดเงียบ → รอบมีของบังคับ ANOMALY_REVIEW (auditor ชม)
- loaders fallback เป็น empty [] ไม่ใช่ mock (นักบัญชี ชม "แอปการเงินไม่ควรโชว์เลขมั่ว")

---

## 4. Code findings ที่ผ่านตรวจปรปักษ์ (13) — สรุป severity

**P1 (5):** R5 viewer-write-access · ตู้แลกเงินไม่ reconcile · config-approve race · transfer/withdraw negative stock · reviewV2Session idempotency
**P2 (8):** TZ day-cut P&L "วันนี้" (UTC vs ไทย 7 ชม.) · กราฟวันแรก undercount · profitK clamp 0 (ซ่อนวันขาดทุน—ตรงข้ามจุดประสงค์โปรแกรม!) · cron overwrite manual-close race · เกณฑ์เงินเกิน ฿50 vs ฿100 ไม่ตรง · photo key ไม่ sanitize (จำกัด—ข้าม org ไม่ได้) · revalidatePath ซ้ำ 4 คู่

**ตกรอบ 2 (verify หักล้าง):** (1) queries.ts:349 hardcode coinRate:10 → **dead code** getV2SessionDetail ไม่มี caller ทั้ง repo (2) prizeCountedOut ไม่ clamp → ทิศทางผิด (ยิ่ง raise loss false-alarm ไม่ใช่ซ่อน)

---

## 5. บทเรียน (meta)
1. **"honesty holes" ยังหลุด** — class เดียวกับที่ owner-critic เคยจับ (fake data as real) ยังเหลือใน 4 จุด · จุดอันตรายสุด = กราฟ dashboard (เจ้าของดูเป็นอย่างแรก) → กฎ: **fallback SAMPLE ต้อง gate ด้วย hasRealData เสมอ ทุก widget**
2. **real-user field-trial จับสิ่งที่ code review จับไม่ได้** — collections "โชว์แค่ anomaly แต่ทำเหมือนทุกรอบ" ไม่ใช่บั๊กโค้ด แต่คือ mental-model mismatch ที่เห็นเฉพาะเวลาคนจริงเดินงานจริง
3. **ช่างซ่อมคือ persona ที่ถูกลืม** — role=viewer + งานช่างเป็น mock ทั้งหมด → 3/10 · meter-rebaseline เป็นทั้ง UX gap และ anti-fraud gap (ช่างโดนใส่ร้าย)
4. **builder เป็นผู้ตัดสินตัวเองแย่สุด (ยืนยันซ้ำ)** — ผ่าน build 3 รอบ + audit 16 คน + fix 2 wave แล้ว ยังเจอ honesty holes + authz gap ใหม่
