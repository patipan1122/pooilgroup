# AUDIT · ClawFleet (ตู้คีบ) · 2026-05-31

> /auditbigteam · Full mode · 8 personas (BA·SA·UX·STAFF·OFC·OWN·DEVIL·QA)
> Scope: ClawFleet only. Spec-only — no feature code in this pass.
> Source persona files: `/tmp/audit_clawfleet_phase1_{ba,sa,ux,staff,ofc,own,devil,qa}.md`
> Next steps after CEO sign-off: `/bigsolvebug` (runtime) → `claude-design` (build).

---

## §1 · Executive Summary

**The one-sentence finding:** ระบบตู้คีบที่ขึ้น production ตอนนี้ (v2) **มี UX มือถือที่ดี แต่ "ถอด" สมองกันโกงที่สำคัญที่สุดทิ้งไป** — การเช็ค token ของตู้แลก (exchanger) ที่จับพนักงานเอา token นอกมาเวียน/ขาย token ออก หายไปหมด

3 ชั้นความจริงที่ค้นพบ:
1. **Schema พร้อม 90% แล้ว** — `CfMachineGroup` (1 ตู้แลก + N ตู้คีบ), `CfCollectionEvent.exchangerCoinsOut` (มิเตอร์ token), `exchangerCashCents` (มิเตอร์เงิน bill-coin), `groupId` บน session+event — มีครบใน `prisma/schema.prisma` แล้ว
2. **v1 (group-based) เคยทำ token cross-check ไว้แล้ว** — มี `deriveGroupCrossCheck` ใน `lib/clawfleet/validation.ts` (DEVIL ยืนยันด้วย grep) → **ยกมาใช้ ไม่ต้องเขียนใหม่**
3. **v2 (branch-based, prod ปัจจุบัน) fork เอาตัวอ่อนกว่ามา** — `deriveBranchCrossCheck` เช็คแค่ 2 ทาง (เงินสด vs มิเตอร์เหรียญ + ตุ๊กตา) ทิ้ง group/exchanger/token หมด

**สิ่งที่ต้องทำ = รวมร่าง:** UX มือถือของ v2 + โมเดล token 3 ชั้นของ v1 + เพิ่มขั้น **bank reconciliation** (ตรวจสลิป+สเตทเมนต์ต่อรอบ) ที่ยังไม่มีในทั้งสองเวอร์ชัน

**ขนาดงานจริง:** ส่วนใหญ่เป็น **code work ไม่ใช่ schema migration ใหญ่** — เพิ่ม 1 ตาราง (`CfSettlement`/`CfDeposit`) + 2 enum state + ดึง logic v1 เข้า UI v2 + redesign back-office ให้ใช้มือถือได้

---

## §2 · Scope (IN / OUT / DEFERRED)

**IN (ทำในรอบนี้):**
- โมเดล Branch > Group > Machine (คืนชั้น group กลับมาใน v2 collect)
- ขั้นเก็บ EXCHANGER (ตู้แลก) — token meter + money meter + cash + transfer (เฉพาะ Type B)
- 3-way cross-check (token / cash / doll) สำหรับ token group · 2-way (cash / doll) สำหรับ cash group
- Doll backward-calc (prevCount + refill − currentCount เทียบ meter delta)
- Bank reconciliation flow + new state (per-round slip pairing)
- Mobile redesign: staff collect (group-aware) + back-office hub/anomaly/bank-recon

**OUT (ตัดทิ้ง — DEVIL):**
- v1 routes ซ้ำซ้อน → ลบหลัง v2 group model เขียน data จริง
- `v2-data.ts` (280 LOC mock) + `v2-queries-legacy.ts` (empty stub) → ลบ
- 3-tier loader (new→legacy→mock) → ตายเมื่อ group model ใช้งานจริง

**DEFERRED (เฟสถัดไป):**
- Auto bank-statement-line matching (MVP = แนบสลิป + ใส่ยอด + ยืนยัน manual)
- CfExchangerLoadout per-promo-tier token pricing UI (จนกว่าจะมีสาขาใช้ promo จริง)
- OCR มิเตอร์ (พิมพ์มือไปก่อน)
- Offline draft queue เต็มรูปแบบ (MVP = per-session resume + retry)

---

## §3 · Conflict Ledger (Phase 3.5)

| # | A | ว่า | B | ว่า | Severity | Resolution | เหตุผล |
|---|---|---|---|---|---|---|---|
| C1 | DEVIL | back-office desktop-first พอ · มือถือแค่ปุ่ม approve | OWN/OFC/UX | มือถือทั้งหมด | P1 | **Hybrid** — hub + approve + bank-recon = mobile-first (งานรายวันเจ้าของ) · insights เชิงลึก + CSV = desktop dense ได้ | CEO สั่ง "ทั้งสองฝั่ง" แต่ DEVIL ถูกว่าตาราง 7-คอลัมน์บนมือถือไร้ประโยชน์ → แยกตาม use |
| C2 | DEVIL | bank-recon maker/checker over-model · MVP แค่แนบสลิป+ยืนยัน | OFC/OWN | ต้อง maker≠checker + เทียบสเตทเมนต์ | P1 | **Phase it** — MVP = แนบสลิป + ใส่ยอด + maker≠checker (role check ฝั่ง server ถูกอยู่แล้ว ราคาถูก) · DEFER = auto statement-line match | CEO พูดถึง "สเตทเมนต์แบงก์" → ต้องมี แต่ทำ manual ก่อน |
| C3 | (rewrite) | เขียน token cross-check ใหม่ใน v2 | SA/DEVIL | ยก `deriveGroupCrossCheck` v1 มา | P0 | **Lift v1** | มีแล้ว ทดสอบแล้ว ใน validation.ts · เขียนใหม่ = บั๊กใหม่ |
| C4 | OWN | บังคับนับตุ๊กตา (กันโกงขายตุ๊กตา) | STAFF | ขอ skip-with-reason | P2 | **บังคับนับ แต่ให้ "นับไม่ได้/ตู้แน่น" + เหตุผล → auto-flag review** | ได้ทั้งกันโกงและไม่ block งานหน้างาน |
| C5 | DEVIL | kill 3-tier loader + mock | (status quo) | เก็บ fallback | P1 | **Kill** เมื่อ group model เขียน data จริง · ลบ v2-data.ts + empty stub | mock หลัง prod UI = "ดูเหมือนเสร็จ แต่ไม่เสร็จ" |

5 conflicts · auto-resolved ทั้งหมด · ไม่มีต้องให้ CEO ตัดสินรอบ 2 (ยกเว้น Top-5 ด้านล่าง)

---

## §4 · Sitemap (corrected)

| หน้า | ใคร | ทำไม | KPI | มือถือ? |
|---|---|---|---|---|
| `/clawfleet/collect` (staff) | พนักงานเก็บเงิน | เลือกสาขา→กลุ่ม→เก็บตู้แลก+ตู้คีบ | จบ 1 กลุ่ม < 10 นาที | **mobile-first** |
| `/clawfleet` hub | เจ้าของ/ออฟฟิศ | 1-glance: เงินควรได้ vs เข้าบัญชี · ธงโกง · รอตรวจ | เห็น 3 ตัวเลขใน 10 วิ | **mobile-first** |
| `/clawfleet/anomalies` | เจ้าของ | ตรวจรอบผิดปกติ approve/recheck/escalate | ตรวจ 1 รอบ < 2 นาที | **mobile-first** |
| `/clawfleet/settle` (NEW) | ออฟฟิศ (checker) | ตรวจสลิป+สเตทเมนต์ต่อรอบ → กดรับเงิน | 0 รอบค้างเกิน 2 วัน | **mobile-first** |
| `/clawfleet/insights` | เจ้าของ/บัญชี | รายงาน รอบ/สาขา/พนักงาน + CSV | export ได้ | desktop dense OK |
| `/clawfleet/stock` | ออฟฟิศ | คลัง+เติมตุ๊กตา+ส่งของ | ตุ๊กตาไม่ขาด | hybrid |
| `/clawfleet/setup`,`/team`,`/audit` | admin | ตั้งค่ากลุ่ม/ตู้/คน + audit trail | — | desktop OK |

---

## §5 · Hero Wireframes (mobile · ~390px) — full set ใน `/tmp/audit_clawfleet_phase1_ux.md` (15 frames)

### 5.1 Staff · เลือกกลุ่ม (NEW — คืนชั้น group)
```
┌─────────────────────────────┐
│ ← สาขา เซ็นทรัลพระราม 2      │
│ รอบเก็บเงิน · CF-0531-02     │
│ ▓▓▓▓░░░░ 2/5 กลุ่ม          │
├─────────────────────────────┤
│ ▣ กลุ่ม A · โซนหน้า   [TOKEN]│
│   ตู้แลก EX-01 + 6 ตู้คีบ    │
│   ● ยังไม่เก็บ        เก็บ → │
├─────────────────────────────┤
│ ▣ กลุ่ม B · โซนหลัง  [เงินสด]│
│   6 ตู้คีบ (ไม่มีตู้แลก)     │
│   ✓ เก็บแล้ว                │
└─────────────────────────────┘
  [ ปิดรอบ + cross-check ] (sticky · disabled จนครบ)
```

### 5.2 Staff · เก็บตู้แลก EXCHANGER (NEW · เฉพาะ Type B) — จุดกันโกงหลัก
```
┌─────────────────────────────┐
│ ← กลุ่ม A · ตู้แลก EX-01     │
│ 🎯 ตู้นี้คือเงินจริงของกลุ่ม │
├─ 1 · มิเตอร์ TOKEN ──────────┤
│ รอบก่อน: 12,400              │
│ วันนี้ (พิมพ์เลข) [ 12,950 ] │
│ → แตก token ออก 550 เหรียญ   │
│ 📷 ถ่ายมิเตอร์ token         │
├─ 2 · มิเตอร์ เงิน (bill coin)┤
│ รอบก่อน: 248,000 ฿          │
│ วันนี้ [ 253,500 ] ฿        │
│ → ควรได้เงิน 5,500 ฿        │
├─ 3 · เงินที่เก็บได้จริง ─────┤
│ เงินสดนับได้ [ 3,500 ] ฿    │
│ เงินโอน      [ 2,000 ] ฿    │
│ รวม 5,500 ฿  🟢 ตรงมิเตอร์   │
│ 📷 สลิป/เงินสด               │
└─────────────────────────────┘
  [ บันทึกตู้แลก → ] (sticky)
```
> Label landmine (STAFF): "มิเตอร์ token" ≠ "มิเตอร์เงิน" ≠ "เงินสดนับได้" ≠ "เงินโอน" → ใส่ icon + ตัวอย่างเลข + helper กันสลับ

### 5.3 Staff · ปิดกลุ่ม → 3-way verdict (HERO anti-fraud)
```
┌─────────────────────────────┐
│   ผลตรวจกลุ่ม A              │
├─────────────────────────────┤
│ 🔴 TOKEN ไม่ตรง             │
│ ตู้แลกแตก   550 เหรียญ       │
│ ตู้คีบรับเข้า 612 เหรียญ      │
│ เกิน +62 → มี token นอกระบบ? │
├─────────────────────────────┤
│ 🟢 เงิน ตรง (5,500 = 5,500)  │
│ 🟢 ตุ๊กตา ตรง (หาย 18 = มิเตอร์)│
├─────────────────────────────┤
│ ⚑ ส่งให้เจ้าของตรวจ          │
│ [ เริ่มกลุ่มถัดไป ]          │
└─────────────────────────────┘
```
> สี: token-fraud = rose-600 (สงวนเฉพาะ token ไม่ตรง) · cash-variance = amber · doll = violet · settled = emerald · pending = slate

### 5.4 Back-office · Bank reconciliation (NEW · mobile)
```
┌─────────────────────────────┐
│ รับเงิน · รอตรวจ 3 รอบ       │
├─────────────────────────────┤
│ CF-0531-02 · สาขา ร.2        │
│ ระบบบันทึก   18,200 ฿        │
│  └ สด 9,200 + โอน 9,000     │
│ ─────────────────────────   │
│ 📎 สลิปฝาก [ แตะดู/แนบ ]    │
│ ยอดในสลิป  [ 18,200 ] ฿     │
│ สเตทเมนต์  [ 18,200 ] ฿     │
│ 🟢 ตรงทั้ง 3 ยอด            │
│ ผู้ฝาก: สมชาย (maker)        │
│ [ ✓ รับเงินแล้ว ] [ เงินไม่ครบ ]│
└─────────────────────────────┘
```
> maker (พนักงานฝาก) ≠ checker (ออฟฟิศกดรับ) · diff-before-write: โชว์ส่วนต่าง recorded vs slip vs statement ก่อนกด

### 5.5 Back-office · Hub (เจ้าของ 1-glance · mobile card stack)
```
┌─────────────────────────────┐
│ วันนี้ · 31 พ.ค.            │
│ ┌─────────┐ ┌─────────┐    │
│ │เงินควรได้│ │เข้าบัญชี │    │
│ │ 142,000 │ │ 121,800 │    │
│ │         │ │ 🔴 -20,200│   │
│ └─────────┘ └─────────┘    │
│ 🚩 ธง token 2 · รอตรวจ 3    │
├─ ต้องทำตอนนี้ ──────────────┤
│ 🔴 กลุ่ม A ร.2 · token +62  │
│ 🟡 รอรับเงิน 3 รอบ          │
│ 🟡 ตุ๊กตาใกล้หมด 4 SKU      │
└─────────────────────────────┘
```

---

## §6 · Data Model & Cross-Check Spec

### 6.1 Org model (มีใน schema แล้ว — แค่ให้ v2 ใช้)
`Branch (1) → Group (N)` · `Group = 1 EXCHANGER + N CLAW` · `groupId` มีบน `CfCollectionSession` + `CfCollectionEvent` แล้ว → v2 collect เปลี่ยนเป็น group-scoped ได้ **โดยไม่ต้อง migrate schema**

### 6.2 Cross-check formulas (lift จาก v1 `deriveGroupCrossCheck`)

**Type B token group (3 ชั้น):**
- (a) **TOKEN** [กันโกงหลัก]: `exchangerCoinsOut` (ตู้แลกแตก) เทียบ `Σ coinMeterDelta` ตู้คีบในกลุ่ม
  - ตู้คีบรับ **เกิน** ตู้แลกแตก → **P0 เสมอ** (token นอกระบบ/พนักงานขาย token) ไม่ว่า cash/doll จะตรง
  - ตู้คีบรับ **ขาด** → P1 (token ค้าง/ตู้เสีย)
- (b) **CASH**: `exchangerCashCents` (มิเตอร์เงินตู้แลก) เทียบ `cashCounted + transfer`
- (c) **DOLL**: `dollMeterDelta` เทียบ backward-calc (ดู 6.3)

**Type A cash group (2 ชั้น):** ต่อตู้คีบ `cashCounted` เทียบ `coinMeterDelta × ฿10` + DOLL

### 6.3 Doll backward-calc (กฎ + edge)
`expected_out = dollCountBefore + refillQty − dollCountAfter` เทียบ `dollMeterDelta`
- รอบแรก (ไม่มี prior count) → ข้าม doll check · flag `SETUP`
- meter delta ติดลบ (rollover/reset) → P1 `METER_ROLLOVER`
- ผลลบ (นับผิด) → block submit
- "นับไม่ได้/ตู้แน่น" → ใส่เหตุผล → auto-flag review (C4)

### 6.4 Session state machine (BA)
```
OPEN → (close) → cross-check
  ├ ผ่าน → PENDING_SETTLEMENT → (office รับเงิน) → SETTLED
  └ ไม่ผ่าน → ANOMALY_REVIEW
        ├ approve → PENDING_SETTLEMENT
        ├ recheck → OPEN (พนักงานเก็บใหม่)
        └ escalate → ANOMALY_REVIEW (ผู้จัดการ)
   SETTLED → (เงินไม่ครบ) → DISPUTE  [super-admin reverse เท่านั้น]
```
2 state ใหม่: `PENDING_SETTLEMENT`, `SETTLED` (+ `DISPUTE`)

### 6.5 New table (SA · OFC) — ตารางเดียวที่ต้องเพิ่ม
`CfSettlement` (หรือ `CfDeposit`): `sessionId[]` (รองรับ batch), `recordedCents`, `slipUrl`, `slipAmountCents`, `statementAmountCents`, `bankRef`, `bankAccount`, `depositedAt`, `makerId`, `checkerId`, `status` (PENDING/SETTLED/SHORT/DISPUTE), `varianceCents`, `note`, `createdAt` · RLS org-scoped · maker≠checker บังคับฝั่ง server

### 6.6 Migration (additive · ปลอดภัย)
`CfSettlement` table + 2 enum values (`PENDING_SETTLEMENT`,`SETTLED`) + 3 indexes · **ไม่มี destructive change** · apply ผ่าน psql ไม่ใช่ `prisma db push` ([[wave-migration-written-not-applied-trap]] · [[pool-schema-drift-2026-05-21]]) · classifier block prod write → CEO รันเอง

---

## §7 · Acceptance Criteria · 3-Way Cross-Check Truth Table (QA core)

| token | cash | doll | → status | flag |
|---|---|---|---|---|
| ตรง | ตรง | ตรง | **CLOSED→PENDING_SETTLEMENT** | — |
| **เกิน** | * | * | **ANOMALY P0** | TOKEN_OVER (โกง) |
| ขาด | ตรง | ตรง | ANOMALY P1 | TOKEN_UNDER |
| ตรง | ขาด | ตรง | ANOMALY P1 | CASH_SHORT |
| ตรง | เกิน | * | ANOMALY P2 | CASH_OVER |
| ตรง | ตรง | ต่าง | ANOMALY P1/P2 | DOLL_VAR |
> (เต็ม 27 combo + doll/bank-recon test matrix ใน `/tmp/audit_clawfleet_phase1_qa.md` · 38 ACs Given/When/Then)

**⛔ Pilot pass/fail (smoke gates):** 0 P0 bugs · ทุก route โหลดไม่มี console error · 1 token-group รอบครบ end-to-end · cross-check แม่นถึงสตางค์ · 1 bank-recon settle สำเร็จ · photo upload รอด network drop (resume) · 2 staff กลุ่มเดียวกันถูก block

---

## §8 · Hardware / Dependency Matrix

| ฟีเจอร์ | สถานะ |
|---|---|
| Token/cash/doll 3-way (manual entry) | 🟢 BUILDABLE_NOW |
| Bank-recon (แนบสลิป+ยืนยัน manual) | 🟢 BUILDABLE_NOW |
| Mobile redesign ทั้ง 2 ฝั่ง | 🟢 BUILDABLE_NOW |
| Auto bank-statement-line match | 🟡 MOCKABLE (manual ก่อน) |
| OCR มิเตอร์ | 🟡 MOCKABLE (พิมพ์มือ) |
| มิเตอร์ token/doll sensor อ่านเอง | 🔴 HW_BLOCKED (พิมพ์มือไปก่อน) |

---

## §9 · Persona Sign-off

| Persona | Status | เงื่อนไข |
|---|---|---|
| BA | 🟡 CONDITIONAL | ต้องเคลียร์ deposit cardinality (1 รอบ:1 ฝาก?) + threshold values |
| SA | ✅ PASS | additive migration · app-layer cross-check SSoT |
| UX | ✅ PASS | 15 wireframes พร้อม · hybrid mobile/desktop ตาม C1 |
| STAFF | 🟡 CONDITIONAL | ต้องมี offline draft/resume + label กันสับสน + doll skip-with-reason |
| OFC | ✅ PASS | 6-state settlement + diff-before-write |
| OWN | 🟡 CONDITIONAL | token cross-check ต้องมาก่อน · pilot 1 สาขา token-group |
| DEVIL | ⚠ OBJECTS-BUT-ACCEPTS | ยอมรับถ้า: lift v1 (ไม่เขียนใหม่) + kill mock/3-tier + bank-recon ทำ MVP ก่อน |
| QA | ✅ PASS | truth table + 38 ACs + 7 pilot gates locked |

0 BLOCKED · 3 CONDITIONAL (ในเกณฑ์ ≤2 +1) → ไม่ trigger Phase 4.5

---

## §10 · Top 5 Decisions — ✅ LOCKED by CEO 2026-05-31

1. **ลำดับ ship: token cross-check ก่อน mobile polish** — ✅ **APPROVE** (CEO เลือกล็อกสเปกก่อน · ตัวกันโกงมาก่อน)
2. **Deposit cardinality** — ✅ **1 รอบเก็บ = 1 การฝาก** (1:1) · UI bank-recon จับคู่ตรงไปตรงมา
3. **Bank-recon MVP** — ✅ **ง่ายสุด แค่แนบสลิป + ยืนยัน** · เลื่อน auto-match สเตทเมนต์/maker-checker เข้มไปเฟสถัดไป
4. **ลบ v1 + mock** — ✅ **ลบหลังรวมร่างเสร็จ** · ยก logic v1 เข้า v2 → ลบ v1 routes + `v2-data.ts` + 3-tier loader
5. **Type A & B อยู่สาขาเดียวกัน** — ✅ **ปนกันได้ในสาขาเดียว** · UI เลือกกลุ่มต้องโชว์ป้าย TOKEN/เงินสด ต่อกลุ่ม (WF-1 รองรับแล้ว)

### ⚠ Nuance สำคัญที่ persona แก้ให้ (BA/SA/OWN/DEVIL grep ยืนยัน)
Token cross-check **ไม่ได้หายสนิท** — มันมีอยู่เป็น **Postgres trigger `cf_session_close_crosscheck`** (migration 20260521000002 · "หัวใจระบบ" คำนวณ `exchanger_coins_out` vs `Σ claw_coins_in`) ตั้งแต่ v1. ปัญหาคือ v2 `closeBranchSession` เปิด session แบบ **branch-scoped ไม่มี group/exchanger event** → เงื่อนไข `IF` ใน trigger ไม่ทำงาน → ตกไปใช้ app-layer 2-way (cash×฿10 + doll) แทน. **แปลว่าตอนนี้ตู้แบบ token ตรวจทุจริตไม่ได้จริงบน prod.** การแก้ = ทำให้ v2 collect เปิด session แบบ group-scoped + กรอก exchanger event → trigger เดิมจะกลับมาทำงาน (ไม่ต้องเขียน logic กันโกงใหม่).

### Build order ที่ล็อกแล้ว (สำหรับ /bigsolvebug + claude-design)
1. **คืน group-scoped collect** — v2 collect: เลือกสาขา→กลุ่ม→เก็บ exchanger (Type B)+claw → ปิดกลุ่ม (เปิด session มี groupId + exchanger event) → trigger 3-way เดิมทำงาน
2. **CfSettlement table** (1 ตาราง) + 2 state (PENDING_SETTLEMENT, SETTLED) + bank-recon MVP (แนบสลิป+ยืนยัน 1:1)
3. **Mobile redesign** ทั้ง 2 ฝั่งตาม WF-1..WF-10 (hub/anomaly/settlement = mobile-first · insights = desktop OK)
4. **ลบ v1 + mock** หลัง group model เขียน data จริงผ่าน
5. Doll meter, photos, offline draft/resume (STAFF CONDITIONAL)

---

## §11 · Pilot Plan

- **1 สาขา · 2 สัปดาห์** · ต้องเป็นสาขาที่มี token-group (ไม่งั้นไม่ได้พิสูจน์ตัวกันโกงหลัก)
- ต้องมีครบ: 3-way cross-check + doll backward-calc + bank-recon live
- "เชื่อได้" = 14 วันติด ทุกรอบ reconcile ตรงถึงบาท + ทุก anomaly มีรูปอธิบาย
- **Day-1 Hotfix Budget: 1 dev-day** สำรองหาบั๊กวันแรก

---

## §12 · Open Risks

- v1/v2 duplication (~4,268 LOC) — ถ้าไม่ลบ = ดูแล 2 ระบบ
- `groupId` nullable → flat-branch session + group session ปนกัน → cross-check กำกวม (QA regression risk)
- 2 cross-check fn (`deriveBranchCrossCheck` vs `deriveGroupCrossCheck`) จะ diverge ถ้าไม่รวม
- mock fallback อาจบัง query จริงพังตอนเทส
- prod migration written-but-not-applied trap ([[wave-migration-written-not-applied-trap]])

---

## §13 · Next Steps (รอ CEO)
1. CEO ตอบ Top-5 (§10)
2. `/bigsolvebug clawfleet` — ตรวจ runtime ของ v2 ปัจจุบันก่อน (หาบั๊กที่ใช้จริงไม่ได้)
3. `claude-design` — build ตาม spec นี้ (group-aware collect + 3-way + bank-recon + mobile back-office)
