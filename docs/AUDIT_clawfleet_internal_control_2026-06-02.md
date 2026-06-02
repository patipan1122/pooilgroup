# ClawFleet — Internal-Control & Numerical Audit (รอบ 2026-06-02)

> ตรวจ logic การคำนวณ cross-check + หลัก internal control ของระบบเก็บเงินตู้คีบ
> Scope: ClawFleet only. Source of truth: `lib/clawfleet/validation.ts`, `lib/clawfleet/v2-actions.ts`, `lib/clawfleet/types.ts`.
> เทียบกับดีไซน์ต้นแบบ `ClawFleet Redesign.html` (branch model · cross-check 2 ทาง).

---

## 1. วิธีตรวจ (method)

ตรวจ 3 ชั้นตามหลัก internal control:
1. **Preventive** — กฎที่ "บล็อกไม่ให้ส่ง" ตั้งแต่ต้นทาง (P0 BLOCK)
2. **Detective** — กฎที่ "จับทีหลัง" ส่งเข้า review (anomaly flags + 2-way cross-check)
3. **Evidence / audit trail** — รูปยืนยัน + ผู้กระทำแต่ละขั้น (maker/checker)

แล้วเดินตัวเลขจริง (worked examples) เพื่อหา "เงินที่หลุดได้โดยระบบไม่จับ".

---

## 2. แผนผังการคุม (control map) — สิ่งที่ "ทำงานถูกแล้ว" ✅

| Control | ที่อยู่ในโค้ด | ทำอะไร |
|---|---|---|
| **Completeness gate** | `closeBranchSession` v2-actions.ts:285–291 | ปิดรอบไม่ได้ถ้ากรอกไม่ครบทุกตู้ (`events.length < machineCount` → reject) — กันลืมเก็บตู้ = กันรายได้หาย |
| **Authorization** | ทุก action ใช้ `userBranchIds()` | พนักงานแตะได้แค่สาขาตัวเอง |
| **P0 — มิเตอร์ถอยหลัง (C2)** | validation.ts:64–76 | มิเตอร์เหรียญ/ตุ๊กตา รอบนี้ < รอบก่อน = BLOCK ส่งไม่ได้ |
| **P0 — มิเตอร์นิ่งแต่มีเงิน (M5)** | validation.ts:91–95 | coinsDelta=0 แต่มีเงินสด = BLOCK (มิเตอร์อาจถูกตัด) |
| **P0 — ตู้แจกฟรี (P4)** | validation.ts:108–112 | ตุ๊กตาออกแต่เหรียญไม่เข้า = BLOCK |
| **Evidence — 5 รูปบังคับ** | `validateBranchPhotos` validation.ts:176–189 | มิเตอร์เหรียญ·มิเตอร์ตุ๊กตา·ตุ๊กตาก่อน·หลัง·เงินสด ขาดใบใดใบหนึ่ง = ส่งไม่ได้ |
| **Detective — cross-check เงิน** | `deriveBranchCrossCheck` validation.ts:230–248 | Σ(มิเตอร์เหรียญขึ้น × ฿10) เทียบ Σ เงินในถาด |
| **Detective — cross-check ตุ๊กตา (มิเตอร์ที่ 2)** | validation.ts:233,239,253–257 | Σ(มิเตอร์ตุ๊กตาขึ้น) เทียบ Σ(ก่อน+เติม−หลัง) — มิเตอร์ตุ๊กตาเป็น "พยานอิสระ" ตัวที่สอง = แข็งแรง |
| **Detective — รายได้ผิดปกติ (A1)** | validation.ts:120–126 | เทียบ median 30 วัน · ต่ำ/สูงเกินเกณฑ์ = flag |
| **Audit trail (maker/checker)** | `createdById` (event), `closedById` (close), `reviewerId`+`reviewedAt` (review) | รู้ว่าใครเก็บ/ใครปิด/ใครอนุมัติ |

**สรุปชั้นนี้:** โครงคุมหลักครบและสอดคล้องกับดีไซน์ — ดีไซน์ "cross-check 2 ทาง" ถูก implement จริง ไม่ใช่แค่หน้าตา.

---

## 3. ช่องโหว่ที่เจอ (findings) — เรียงตามความเสี่ยงเงิน

> **อัปเดต 2026-06-02:** CEO อนุมัติแก้ F1/F2/F5 แล้ว — สถานะ ✅ FIXED (ดูในแต่ละข้อ) · branch `claude/clawfleet-design-impl`

### 🔴 F1 (P1 · Material) — เงินขาดก้อนใหญ่แต่ "ไม่ถึง 5%" จะหลุด — ✅ FIXED (฿100 floor)

**โค้ด:** `deriveBranchCrossCheck` validation.ts:243
```ts
if (cashVarianceCents < 0 && Math.abs(cashVarianceBps) > toleranceBps) { ... flag ... }
```
ปิดรอบ "flag เฉพาะเมื่อ % เกิน 5%" เท่านั้น — **ไม่มีเพดานเป็นจำนวนเงิน (absolute floor)**

**เดินตัวเลขจริง:**
| สาขา | คาดได้ (จากมิเตอร์) | เก็บจริง | ขาด | % | ระบบ flag? |
|---|---|---|---|---|---|
| สาขาเล็ก | ฿8,400 | ฿5,860 | ฿2,540 | 30.2% | ✅ flag |
| **สาขายอดสูง** | **฿120,000** | **฿117,500** | **฿2,500** | **2.08%** | ❌ **ไม่ flag — ฿2,500 หลุด** |

ขาดเท่ากันเกือบเป๊ะ (฿2,540 vs ฿2,500) แต่สาขาใหญ่ "รอด" เพราะคิดเป็น % ต่ำ → เป็นช่องให้ขโมยทีละนิดในสาขายอดสูงได้เรื่อย ๆ

**ที่สำคัญ:** กฎ "ราย 1 ตู้" (`deriveEvent` validation.ts:80–85) ใช้ `absCash > ฿100 **หรือ** pct > 5%` อยู่แล้ว — แต่ "ตอนปิดรอบ" กลับใช้แค่ % → **ไม่สอดคล้องกัน และตอนปิดอ่อนกว่า** (ตอนปิดคือตัวที่ตัดสินสถานะ ANOMALY_REVIEW จริง)

**แนะนำ:** เพิ่มเงื่อนไข OR ด้วยเพดานบาท เช่น
```ts
if (cashVarianceCents < 0 && (Math.abs(cashVarianceBps) > toleranceBps
      || Math.abs(cashVarianceCents) > FLOOR)) { ... }
```
**Trade-off (CEO ตัดสิน):** FLOOR ต่ำ = จับได้มากแต่ alarm เยอะ (พอเตือนบ่อยคนจะเริ่มไม่สนใจ — เป็นจุดอ่อนเชิงคุมเอง) · FLOOR สูง = เงียบกว่าแต่ปล่อยก้อนกลาง ๆ
- ตัวเลือก A: FLOOR = ฿100 (เท่ากับกฎรายตู้ · จับเข้มสุด)
- ตัวเลือก B: FLOOR = ฿300–500 ต่อรอบสาขา (สมดุล · ลด noise)
> **✅ FIXED (CEO เลือก A = ฿100):** validation.ts `deriveBranchCrossCheck` เพิ่มเงื่อนไข `|cashVarianceCents| > CASH_VARIANCE_WARN_CENTS (฿100)` เป็น OR กับ `|bps| > 5%` · ตัวอย่าง ฿120,000 เก็บ ฿117,500 (ขาด ฿2,500 = 2%) ตอนนี้ flag M3 แล้ว

---

### 🟠 F2 (P2 · Segregation of Duties) — คนตรวจอนุมัติงานตัวเองได้ — ✅ FIXED

**โค้ด:** `reviewV2Session` v2-actions.ts:55–62 — บันทึก `reviewerId` แต่ **ไม่เช็คว่า reviewer ≠ คนเก็บ/คนปิดรอบ (`closedById`)**

ผล: ถ้าพนักงานคนเดียวกันมีสิทธิ์ทั้งเก็บและ review → เก็บเงินขาดเอง แล้วกด "อนุมัติ" ปิดเรื่องเองได้ = แยกหน้าที่ไม่ขาด (maker = checker)

**✅ FIXED:** `reviewV2Session` v2-actions.ts เพิ่มเช็ค `decision==="approve" && cf.closedById === session.user.id → reject` · ยัง "ตรวจซ้ำ/ส่งต่อ" ได้

---

### 🟠 F5 (P2 · Netting) — ขาด/เกินหักล้างกันข้ามตู้ ทำให้รอบไม่ถูก flag — ✅ FIXED

`deriveBranchCrossCheck` รวมทุกตู้ก่อนค่อยเทียบ (Σ แล้วเทียบ) → ถ้าตู้ A ขาด ฿2,000 แต่ตู้ B เกิน ฿2,000 (กรอกสลับ/ปั้นเลข) ผลรวม = ฿0 → **ทั้งรอบดู "ปกติ" ไม่เข้า review** ทั้งที่มีตู้ผิดจริง

ราย 1 ตู้ (`deriveEvent`) จับได้ (มี flag M2/M3 ราย event) แต่ **flag รายตู้ไม่ได้ดันสถานะรอบให้เป็น ANOMALY_REVIEW** — สถานะรอบมาจาก aggregate อย่างเดียว

**✅ FIXED:** `deriveBranchCrossCheck` ตอนวน events คำนวณ per-machine variance ด้วย · ถ้าตู้ใดตู้หนึ่งขาดเกิน ฿100/5% หรือตุ๊กตาคลาดเกินเกณฑ์ → ดัน flag M3/P3 + ทั้งรอบเป็น ANOMALY_REVIEW แม้ผลรวมจะ net เป็น 0

---

### 🟡 F3 (P3) — `prizeCountedOut` ไม่ clamp · นับเกิน/เติมเกินทำให้ตัวเลขเพี้ยน

validation.ts:234 `prizeCountedOut += stockBefore + refillQty − stockAfter` ไม่กันค่าติดลบ — ถ้า `stockAfter > stockBefore+refill` (นับผิด/เติมเกิน) ค่าจะติดลบ → ดันให้ `prizeVariance` ดู "ตุ๊กตาหาย" ทั้งที่เป็น error การนับ
**แนะนำ:** แยก flag "นับสต๊อกไม่สมเหตุผล (S1)" ออกจาก "ตุ๊กตาหาย"

### 🟡 F4 (P3 · Display) — ป้าย "ตุ๊กตาหาย" ไม่บอกทิศทาง

flag ใช้ `Math.abs(prizeVariance)` → จับทั้ง 2 ทิศ (มิเตอร์>นับ และ นับ>มิเตอร์) ถูกแล้ว แต่ label ขึ้น "ตุ๊กตาหาย/ขาด" อย่างเดียว ทั้งที่ "นับหายมากกว่ามิเตอร์" คนละเคส (sensor นับขาด/มีคนหยิบมือ) → ควรแยกข้อความ

### ⚪ F6 (info) — A1 baseline เงียบช่วง 30 วันแรก
median ยังเป็น null ตอน cold-start → outlier detection ยังไม่ทำงานช่วงแรก · ยอมรับได้ แต่ควรรู้

---

## 4. สรุปสำหรับ CEO (ภาษาคน)

ระบบกันโกงตู้คีบ **โครงหลักแน่นแล้ว** — บังคับถ่ายรูปครบ 5 ใบ, ปิดรอบไม่ได้ถ้าเก็บไม่ครบตู้, มี "มิเตอร์ตุ๊กตา" เป็นพยานตัวที่สองเทียบกับการนับ, และบล็อกเคสโกงชัด ๆ (ตู้แจกฟรี/มิเตอร์ถูกตัด) ตั้งแต่ต้นทาง

มี **3 รูที่อุดแล้ว** (CEO อนุมัติ 2026-06-02) เพื่อให้กันโกงได้จริงระดับ "ขโมยทีละนิดก็ไม่รอด":
1. ✅ **เงินขาดก้อนกลาง ๆ ในสาขายอดสูงหลุด** → เพิ่ม "เพดานบาท ฿100/รอบ" (CEO เลือกเข้มสุด) ตอนนี้ขาดเกิน ฿100 จับทุกเคสไม่ว่ากี่ %
2. ✅ **คนตรวจอนุมัติงานตัวเองได้** → ห้าม approve รอบที่ตัวเองปิด (ตรวจซ้ำ/ส่งต่อยังได้)
3. ✅ **ขาด/เกินหักกันข้ามตู้ทำให้ทั้งรอบดูปกติ** → ตู้เดียวผิดหนักก็ดันทั้งรอบเข้าตรวจ

> ผลข้างเคียงที่ต้องรู้: เพดาน ฿100 ทำให้มี anomaly ขึ้นบ่อยกว่าเดิม — ถ้าเจอ false alarm เยอะเกินไปในการใช้จริง บอกได้ ปรับเป็น ฿300-500 ได้ทันที (แก้ค่าเดียว)

---

## 5. ภาคผนวก — ค่าคงที่ปัจจุบัน (types.ts DEFAULTS)

| ค่า | ปัจจุบัน | หมายเหตุ |
|---|---|---|
| `GROUP_TOLERANCE_BPS` | 500 (5%) | เกณฑ์ % เงินขาด ตอนปิดรอบ |
| `CASH_VARIANCE_ACCEPTABLE_CENTS` | 2000 (฿20) | ขาดเล็กน้อย รายตู้ |
| `CASH_VARIANCE_WARN_CENTS` | 10000 (฿100) | ขาดเยอะ รายตู้ (= candidate FLOOR ข้อ F1) |
| `DOLL_VARIANCE_ACCEPTABLE` | 2 ตัว | ตุ๊กตาคลาดเคลื่อนยอมรับได้ |
| `DOLL_VARIANCE_PCT` | 0.1 (10%) | ตุ๊กตาคลาดเคลื่อน % |
