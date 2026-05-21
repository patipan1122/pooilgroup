# ClawFleet — Master Plan (ฉบับสมบูรณ์ · รอบ 2)

> **Status:** Planning v2 · awaiting CEO decisions on D1-D10
> **Last update:** 2026-05-21 (รอบประชุม #2 · ทีม BA/QA/QC/SA/UX/PM + persona เจ้าร้าน + พนักงาน)
> **Module:** Pool legacy module · slug `clawfleet`
> **Estimated:** 8-9 วัน · 7 phases · ~9 tables · ไม่ใช่ SaaS · ไม่มี OCR
> **Pilot:** 1 สาขา 3 วัน → ขยาย 3 สาขา → ครบ 10 สาขา (1 เดือน rollout)

---

## 📑 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [ปัญหา & เป้าหมาย](#2-ปัญหา--เป้าหมาย)
3. [Solution Overview](#3-solution-overview)
4. [Personas (5 roles)](#4-personas)
5. [Workflow Detail](#5-workflow-detail)
6. [กฎ "กันโง่" ทุกข้อ (C/M/P/A/G/S/F · 32 rules)](#6-กฎกันโง่)
7. [Token Exchange Group + Cross-check](#7-token-exchange-group)
8. [Data Model (9 tables)](#8-data-model)
9. [UX/UI (mockups + principles)](#9-uxui)
10. [Stock Module](#10-stock-module)
11. [Photo Pipeline](#11-photo-pipeline)
12. [Roles & Permissions](#12-roles--permissions)
13. [Route Structure](#13-route-structure)
14. [Phase Plan (8-9 วัน)](#14-phase-plan)
15. [Risk Register](#15-risk-register)
16. [Pre-launch Checklist](#16-pre-launch-checklist)
17. [Decisions Pending (D1-D10)](#17-decisions-pending)
18. [Open Questions (Q1-Q7)](#18-open-questions)
19. [Glossary](#19-glossary)
20. [Appendix](#20-appendix)

---

## 1. Executive Summary

**ระบบบริหารตู้คีบ + ตู้แลกเหรียญ multi-branch** สำหรับเจ้าของธุรกิจไทยที่มี ~100 ตู้ใน ~10 สาขา. แทน Google Sheets ปัจจุบัน (1 sheet/สาขา · ดูภาพรวมไม่ได้ · กรอกผิดเยอะ).

**Core innovation:** "Token Exchange Group" — 1 ตู้แลกเหรียญ ผูกกับ 10 ตู้คีบ · ตรวจ cross-check "เหรียญที่ตู้แลกแจก ≈ เหรียญที่เข้าตู้คีบรวม" → กันพนักงาน/ลูกค้า แลกเหรียญนอกระบบ (โกง).

**กฎกันโง่ 7 หมวด 32 ข้อ:** Continuity (มิเตอร์ต่อเนื่อง) · Money · Product · Anomaly · Group cross-check · Stock · Photo. แต่ละข้อมี severity (P0 BLOCK / P1 FLAG / P2 WARN) + ผู้อนุมัติ override.

**Tech:** Pool legacy stack (Next.js 15 + Supabase + Prisma + R2) — เลียน pattern Repair module. ไม่ใช่ SaaS · ไม่มี OCR · ไม่มี PIN auth แยก (ใช้ Pool email login).

**Effort realistic:** 8-9 วัน · dev คนเดียว (Claude). MVP scope strict: 11 tables · 9 G-rules cross-check · 4 รูป/ตู้ + retention 30 วัน · 1 form scroll เดียว · 1 หน้ารีพอต.

---

## 2. ปัญหา & เป้าหมาย

### 2.1 Pain ของ CEO ปัจจุบัน

| # | Pain | ผลกระทบ |
|---|---|---|
| 1 | **Sheets กระจาย** (1/สาขา) | CEO ดูภาพรวม 100 ตู้ไม่ได้ · ไม่รู้ตู้ไหนปัง/ห่วย |
| 2 | **กรอกผิดเยอะ** | มิเตอร์ 4-6 หลัก · พิมพ์ผิด 1 ตัว = รันยาวพังหมด |
| 3 | **ไม่มี validation** | ไม่ cross-check เงิน/มิเตอร์/สต๊อก · ผิดไม่รู้ |
| 4 | **ดูยาก** | 21 columns raw · หาตู้/พนักงานน่าสงสัยไม่ได้ |
| 5 | **คนแลกเหรียญนอกตู้** | ลูกค้า/พนักงานเอาเหรียญจากที่อื่นมาใช้ = รายได้หาย ไม่รู้ |
| 6 | **สต๊อกหาย** | ไม่ track stock outside ตู้ · ของหายไม่เจอ |

### 2.2 เป้าหมาย (Success Metric)

| # | Goal | วัดยังไง |
|---|---|---|
| G1 | CEO เห็นรายรับ 100 ตู้ใน 10 วินาที | Time-to-insight on report page |
| G2 | พนักงาน 1 รอบเก็บ < 70 นาที (11 ตู้) | Avg session duration |
| G3 | กรอกผิด < 5% | % events flagged as anomaly |
| G4 | "แลกนอกตู้" detectable | G1 cross-check active 100% sessions |
| G5 | สต๊อกหายจับได้ภายใน 1 วัน | Daily count variance flag |

---

## 3. Solution Overview

### 3.1 Core Concept

**3 ชั้นป้องกัน:**

```
┌─────────────────────────────────────────────────┐
│  ชั้น 1: Auto-prefill (พิมพ์น้อย ผิดน้อย)        │
│   - มิเตอร์ "ก่อน" auto จากรอบก่อน              │
│   - พนักงานพิมพ์แค่ "หลัง" + เงินสด             │
├─────────────────────────────────────────────────┤
│  ชั้น 2: Real-time validation (display only)     │
│   - เห็น ✅/🟡/🔴 ทันทีตอนกรอก                  │
│   - ไม่ block submit (เว้น P0 เช่น มิเตอร์ถอยหลัง)│
├─────────────────────────────────────────────────┤
│  ชั้น 3: Session cross-check (หัวใจระบบ)         │
│   - ปิด session 11 ตู้ → trigger เปรียบเทียบ      │
│   - ขาด >5% = ANOMALY_REVIEW → หัวหน้าอนุมัติ    │
└─────────────────────────────────────────────────┘
```

### 3.2 ที่ตัดทิ้งจาก scope (Phase 2 ทีหลัง)

| ตัด | เหตุผล |
|---|---|
| ❌ SaaS multi-tenant | CEO เป็น customer #1 · ทำ tenant เดียวก่อน |
| ❌ OCR Claude vision | Cost ~฿900/เดือน · trade-off พนักงานพิมพ์เอง |
| ❌ PIN auth แยก | ใช้ Pool email login เดิม |
| ❌ DC stock transfers | คลังในสาขาก่อน · DC ทีหลัง |
| ❌ Wizard 8 step | 1 form scroll เดียวพอ |
| ❌ Telegram alert | LINE notify wave 2 |
| ❌ PDF export | CSV พอ |
| ❌ Chart/heatmap dashboard | ตาราง + drawer พอ |
| ❌ Top/Bottom 10 ranking | Sort table column แทน |
| ❌ Migration Sheets history | เริ่มสะอาด · 1 initial event/ตู้ |

---

## 4. Personas

| Role | Pool UserRole | จำนวน | สิทธิ์หลัก | ใช้บ่อย |
|---|---|---|---|---|
| **พนักงานเก็บเงิน** | `STAFF` | ~20 คน (2/สาขา) | scan QR · กรอก session · ดูรอบตัวเอง 7 วัน | ทุกวัน · มือถือ |
| **หัวหน้าสาขา** | `BRANCH_MANAGER` | 10 คน | review anomaly · approve flag · setup loadout · นับสต๊อก | ทุกวัน · tablet/PC |
| **CEO/Admin** | `SUPER_ADMIN` | 1 คน | ดูทุกอย่าง · ตั้ง threshold · เพิ่ม/ลบสาขา/ตู้ | สัปดาห์ละ 2-3 ครั้ง · PC |
| **บัญชี** | (role ใหม่ optional) | 1-2 คน | ดูรายงาน · export CSV · ปิดเดือน | รายเดือน · PC |
| **DC staff** | (Phase 2) | - | - | - |

### 4.1 เสียงจาก persona (highlights)

**เจ้าร้าน:**
- "อย่ามาขออนุมัติทุก flag — ห่าง <฿50 ผ่านเองได้"
- "เห็น 3 อย่างพอ: รายได้วันนี้ · ขาดวันนี้ · ตู้ไหนต้องเติม"
- "ตู้ไม่มีคนเก็บ 3 วัน → LINE เตือนผม"
- "ห้าม crash ตอนตู้แลกพัง — ต้องเก็บตู้คีบต่อได้"

**พนักงาน:**
- "44 รูป มือสกปรกถ่ายยาก — ขอ 1-tap camera"
- "เน็ตที่ตลาดห่วย — ขอ offline ไว้ก่อน sync ทีหลัง"
- "ผมเคยกรอกผิดตู้ เสีย 2 ชม.แก้" → **บังคับ QR scan**
- "บางทีต้องเก็บ 2 group วันเดียว"
- "ขอปุ่ม 'ตู้นี้กดไม่ออก'"

---

## 5. Workflow Detail

### 5.1 Filler — รอบเก็บกลุ่ม (Session)

```
[1] Login (Pool email/password)
[2] เลือกสาขา (auto ถ้ามีสาขาเดียว · permission)
[3] เลือก Group (1 ตู้แลก + N ตู้คีบ)
[4] เปิด Session → status=OPEN
[5] สำหรับแต่ละตู้ใน group (11 ตู้ปกติ):
    [5a] Scan QR ตู้ (บังคับ · กันกรอกผิดตู้)
    [5b] เปิดตู้ · นับเหรียญ/ตุ๊กตา
    [5c] ถ่ายรูป 4 ใบ (CLAW) / 3 ใบ (EX): มิเตอร์ก่อน · เงิน · ของในตู้ · มิเตอร์หลัง
    [5d] กรอกฟอร์ม 6 ช่อง (CLAW) / 3 ช่อง (EX)
    [5e] เห็น delta real-time → ✅/🟡/🔴
    [5f] กด "บันทึก & ถัดไป" → ตู้นั้นปิด ✓
    [5g] เติมตุ๊กตา (ถ้าต้อง)
[6] ครบ 11 ตู้ → ปุ่ม "ปิดรอบ" active
[7] ระบบ trigger cross-check:
    - เหรียญตู้แลกแจก vs รวมเหรียญตู้คีบ
    - ถ้า <5% → status=CLOSED (ผ่าน)
    - ถ้า >5% → status=ANOMALY_REVIEW + บังคับใส่เหตุผล + ส่งหัวหน้า
[8] Summary + ส่งหัวหน้า
```

**Time estimate (BA):** ~63 นาที/session · 1 พนักงาน ทำได้ 6-7 sessions/วัน · 100 ตู้ = 1.5-3 คน

### 5.2 Branch Manager — Review Flow

```
[ทุกเช้า] เปิด dashboard สาขาตัวเอง
[เช้า] ดู KPI 3 อัน: รายรับเมื่อวาน · จำนวน ANOMALY_REVIEW · ตู้ stock ใกล้หมด
[ระหว่างวัน] LINE notify เมื่อมี flag → คลิกเข้าระบบ review
[Review session ANOMALY_REVIEW]:
   - เปิด drawer ดู cross-check detail
   - ดูรูปทั้ง 4×11 = 44 รูป
   - เลือก: [อนุมัติ] · [ขอ recheck] · [escalate CEO]
[เย็น] นับสต๊อกในสาขา (1 ครั้ง/วัน)
   - ระบบโชว์ "ที่ควรเหลือ" vs "นับจริง"
   - flag >5% → ใส่เหตุผล
```

### 5.3 CEO — Daily Check

```
[เช้า] เปิด LINE bot summary (Phase 2)
[Weekly] เปิดรีพอตหน้าเดียว
   - Filter "7 วัน + ทุกสาขา"
   - สแกน summary bar: รวม · ขาด · alert
   - คลิกแถวที่ flag → drawer ดู detail
   - ถ้าซ้ำๆ ตู้/พนักงานเดียวกัน → ตัดสินใจ
```

---

## 6. กฎกันโง่

### 6.1 หมวด C — Continuity (มิเตอร์ต่อเนื่อง)

| ID | กฎ | Action | Severity | Override |
|---|---|---|---|---|
| C1 | มิเตอร์ "ก่อน" รอบนี้ = "หลัง" รอบก่อน (เป๊ะ) | flag CONTINUITY_BREAK (ไม่ block · บางครั้งช่างเปลี่ยน board) | P0 | CEO |
| C2 | มิเตอร์ "หลัง" < "ก่อน" | BLOCK | P0 | CEO + รูปยืนยัน |
| C3 | วันที่รอบนี้ ≥ รอบก่อน | BLOCK | P0 | - |
| C4 | stock หลังเติม ≥ stock ก่อนเติม (ถ้าเติม) | WARN | P2 | - |

### 6.2 หมวด M — Money (เงินตรงมิเตอร์)

| ID | กฎ | Action | Severity | Override |
|---|---|---|---|---|
| M1 | \|เงินสด - ที่ควรได้\| ≤ ฿20 | ผ่าน | - | - |
| M2 | ขาด ฿20-฿100 | FLAG เหลือง · บันทึก | P2 | - |
| M3 | ขาด >฿100 หรือ >5% | FLAG · ใส่เหตุผล | P1 | หัวหน้าสาขา |
| M4 | เกิน >฿50 | WARN (เหรียญทดสอบ?) | P2 | - |
| M5 | มิเตอร์ไม่ขยับ แต่มีเงิน | BLOCK (มิเตอร์เสีย?) | P0 | หัวหน้า + รูป |

### 6.3 หมวด P — Product (ตุ๊กตาตรงสต๊อก)

| ID | กฎ | Action | Severity |
|---|---|---|---|
| P1 | (ก่อน + เติม) - หลัง = ตุ๊กตาตามมิเตอร์ | ผ่าน | - |
| P2 | ต่าง 1-2 ตัว | WARN | P2 |
| P3 | ต่าง >2 ตัว หรือ >10% | FLAG · ใส่เหตุผล | P1 |
| P4 | ตุ๊กตามิเตอร์ขยับ แต่เหรียญไม่ขยับ | BLOCK (ตู้แจกฟรี?) | P0 |
| P5 | เหรียญขยับเยอะ แต่ตุ๊กตาไม่ออก | WARN (ตู้คีบยาก) | P2 |
| P6 | stock หลังเติม > capacity ตู้ | BLOCK (calc ผิด) | P0 |

### 6.4 หมวด A — Anomaly (เทียบ baseline)

| ID | กฎ | Action | Severity |
|---|---|---|---|
| A1 | รายได้รอบนี้ < 30% หรือ > 300% ของ median 30 วัน | FLAG | P1 |
| A2 | ตู้ไม่มี collection >7 วัน · มิเตอร์ขยับ | WARN + LINE | P2 |
| A3 | ตู้เดียวกัน 2 รอบ/วัน | WARN + reason | P2 |
| A4 | พนักงาน 1 คน flag M3/P3 >3 ครั้ง/7วัน | ALERT CEO | P1 |

### 6.5 หมวด G — Group Cross-check ⭐ (หัวใจ)

| ID | กฎ | สูตร | Action | Severity |
|---|---|---|---|---|
| **G1** | Σ diff เหรียญ 10 ตู้คีบ ≈ เหรียญตู้แลกแจก | \|in - out\| / out > 5% | FLAG | P1 |
| **G2** | ตู้แลกแจก >0 แต่ Σ ตู้คีบ = 0 | hard rule | **BLOCK** | P0 |
| G3 | ตู้คีบมีเหรียญเข้า แต่ตู้แลกแจก 0 | hard rule | WARN | P2 |
| G4 | เงินสดตู้แลก ≈ เหรียญแจก × rate - promo | \|cash - expected\|/expected > 5% | FLAG | P1 |
| G5 | กรอก promo >0 แต่ไม่มีรูปสลิป | hard | WARN | P2 |
| G6 | promo discount >30% ของยอด session | rule | FLAG | P1 |
| **G7** | กรอกตู้คีบไม่ครบ 11 ตู้ก่อนปิด | hard | **BLOCK** | P0 |
| G8 | timestamp ตู้แรก vs ตู้สุดท้าย ห่าง >3 ชม. | rule | WARN | P2 |
| G9 | "ตู้แลกเสีย" mode → ข้าม G1-G4 + รูปตู้เสีย + หัวหน้า approve | conditional | - | - |

### 6.6 หมวด S — Stock

| ID | กฎ | Action | Severity |
|---|---|---|---|
| S1 | นับสต๊อกต่าง >5% หรือ >10 ตัว | FLAG + รูปนับ | P1 |
| S2 | สต๊อกติดลบ (เติมเกินรับเข้า) | BLOCK | P0 |
| S3 | รับเข้าไม่มีใบเสร็จ >3 ครั้ง/เดือน | FLAG | P1 |

### 6.7 หมวด F — Photo

| ID | กฎ | Action | Severity |
|---|---|---|---|
| F1 | รูป 4 ใบ/ตู้คีบ (3 ตู้แลก) ครบ | BLOCK ถ้าไม่ครบ | P0 |
| F2 | รูปขนาด <50KB หรือเบลอ (Laplacian <100) | WARN · ส่งใหม่ | P2 |
| F3 | รูปซ้ำ (perceptual hash) | FLAG (สงสัย fraud) | P1 |

**สรุป:** 32 rules · P0 BLOCK = 8 ข้อ · P1 FLAG = 11 · P2 WARN = 13

---

## 7. Token Exchange Group

### 7.1 Concept

```
                  ┌──────────────────┐
                  │  ตู้แลก #EX-01    │
                  │  รับเงิน → แจกเหรียญ│
                  │  Promo: 100฿/11   │
                  └────────┬─────────┘
                           │ จ่ายเหรียญ
        ┌──────────┬───────┼───────┬──────────┐
        ▼          ▼       ▼       ▼          ▼
    ตู้คีบ A-01  A-02   A-03   ...        A-10
    (price 10฿/ครั้ง)
```

### 7.2 Cross-check Rule (รายละเอียด)

```
Step 1: ปิด session → trigger fires
Step 2: คำนวณ coins_out (ตู้แลกแจก)
        = cash_counted (ในตู้แลก) × exchanger_rate
        e.g. 75,200 บาท × 1.0 coin/บาท + promo bonus
Step 3: คำนวณ coins_in (ตู้คีบรับ)
        = Σ (coin_meter_after - coin_meter_before) ของ 10 ตู้คีบ
Step 4: variance_bps = (coins_in - coins_out) / coins_out × 10000
Step 5: ถ้า |variance_bps| > tolerance_bps (default 500 = 5%)
        → status = ANOMALY_REVIEW
        → anomaly_flags += "COIN_GROUP_MISMATCH"
        → บังคับใส่เหตุผล + ส่งหัวหน้า
```

### 7.3 Promo Storage

```jsonc
// cf_exchanger_loadouts.promo_tiers
[
  { "thb": 100, "coins": 11 },    // 100฿ → 11 เหรียญ (ปกติ 10)
  { "thb": 500, "coins": 60 },    // 500฿ → 60 เหรียญ
  { "thb": 1000, "coins": 130 }   // 1000฿ → 130 เหรียญ
]
```

→ พนักงานกรอก "เหรียญแจกจริง" รวม promo · ระบบไม่ต้องคำนวณ
→ เปลี่ยน promo = insert row ใหม่ใน `cf_exchanger_loadouts` + set `effective_to` ของ row เก่า

---

## 8. Data Model

### 8.1 9 Tables Summary

| Table | Purpose |
|---|---|
| `cf_machines` | ทุกตู้ (CLAW + EXCHANGER) · `kind` field |
| `cf_machine_groups` | 1 group = 1 EX + N CLAW |
| `cf_products` | สินค้าในตู้ |
| `cf_machine_loadouts` | สินค้า+ราคา/ครั้ง ในตู้คีบ (effective period) |
| `cf_exchanger_loadouts` | rate + promo tiers ของตู้แลก |
| `cf_collection_sessions` | รอบเก็บกลุ่ม + cross-check result |
| `cf_collection_events` | รายตู้ใน session + photo URLs |
| `cf_stock_movements` | RECEIVE / LOAD_TO_MACHINE / COUNT_SNAPSHOT / ADJUST |
| `cf_audit_log` | ทุก mutation (per memory role-rank guard) |

### 8.2 Prisma Sketch (key models)

```prisma
enum CfMachineKind   { CLAW EXCHANGER }
enum CfEventType     { INITIAL COLLECTION VOID }
enum CfStockMoveType { RECEIVE LOAD_TO_MACHINE COUNT_SNAPSHOT ADJUST }
enum CfSessionStatus { OPEN CLOSED ANOMALY_REVIEW LOCKED }

model CfMachine {
  id              String         @id @default(uuid()) @db.Uuid
  orgId           String         @map("org_id") @db.Uuid
  branchId        String         @map("branch_id") @db.Uuid
  groupId         String?        @map("group_id") @db.Uuid    // FK ตรง · ไม่ใช่ junction
  code            String                                       // "CW-CPW-001"
  kind            CfMachineKind
  qrToken         String         @unique @map("qr_token")     // สำหรับ scan
  // mirror (updated by trigger)
  lastCoinMeter   Int            @default(0) @map("last_coin_meter")
  lastDollMeter   Int            @default(0) @map("last_doll_meter")
  lastEventAt     DateTime?      @map("last_event_at") @db.Timestamptz(6)
  isActive        Boolean        @default(true) @map("is_active")
  @@unique([orgId, code])
  @@index([orgId, branchId, kind, isActive])
  @@index([orgId, groupId])
  @@map("cf_machines")
}

model CfCollectionSession {
  id                String           @id @default(uuid()) @db.Uuid
  orgId             String           @map("org_id") @db.Uuid
  groupId           String           @map("group_id") @db.Uuid
  openedAt          DateTime         @default(now()) @map("opened_at") @db.Timestamptz(6)
  closedAt          DateTime?        @map("closed_at") @db.Timestamptz(6)
  closedById        String?          @map("closed_by_id") @db.Uuid
  status            CfSessionStatus  @default(OPEN)
  // cross-check (filled by trigger)
  exchangerCoinsOut Int?             @map("exchanger_coins_out")
  clawCoinsIn       Int?             @map("claw_coins_in")
  coinVarianceBps   Int?             @map("coin_variance_bps")
  anomalyFlags      String[]         @default([]) @map("anomaly_flags")
  reviewerId        String?          @map("reviewer_id") @db.Uuid
  reviewedAt        DateTime?        @map("reviewed_at") @db.Timestamptz(6)
  reviewNote        String?          @map("review_note")
  @@unique([groupId, status])  // กัน race · 1 OPEN session/group เท่านั้น
  @@index([orgId, groupId, openedAt(sort: Desc)])
  @@index([orgId, status])
  @@map("cf_collection_sessions")
}

model CfCollectionEvent {
  id              String       @id @default(uuid()) @db.Uuid
  orgId           String       @map("org_id") @db.Uuid
  sessionId       String?      @map("session_id") @db.Uuid
  machineId       String       @map("machine_id") @db.Uuid
  eventType       CfEventType  @default(COLLECTION) @map("event_type")
  collectedAt     DateTime     @map("collected_at") @db.Timestamptz(6)
  collectedById   String       @map("collected_by_id") @db.Uuid
  // ทั้ง CLAW + EX
  coinMeterBefore Int          @map("coin_meter_before")
  coinMeterAfter  Int          @map("coin_meter_after")
  cashCountedCents Int         @map("cash_counted_cents")
  // CLAW only (nullable)
  dollMeterBefore Int?         @map("doll_meter_before")
  dollMeterAfter  Int?         @map("doll_meter_after")
  stockBefore     Int?         @map("stock_before")
  stockAfter      Int?         @map("stock_after")
  refillQty       Int?         @map("refill_qty")
  // photos (R2 URLs)
  photoMeterBeforeUrl String?  @map("photo_meter_before_url")
  photoCashUrl        String?  @map("photo_cash_url")
  photoMeterAfterUrl  String?  @map("photo_meter_after_url")
  photoStockUrl       String?  @map("photo_stock_url")
  photosPurgedAt      DateTime? @map("photos_purged_at") @db.Timestamptz(6)
  // generated (surgical SQL หลัง prisma db push)
  // coinsDelta, dollsDelta, dollVariance — INT GENERATED ALWAYS AS ... STORED
  notes           String?
  @@index([orgId, machineId, collectedAt(sort: Desc)])
  @@index([sessionId])
  @@map("cf_collection_events")
}
```

### 8.3 Cross-check Trigger SQL

```sql
CREATE OR REPLACE FUNCTION cf_session_close_crosscheck()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exchanger_id  UUID;
  v_coins_out     INT;
  v_coins_in      INT;
  v_tolerance     INT := 500;  -- 5% in bps
  v_variance      INT;
BEGIN
  IF NEW.status <> 'CLOSED' OR OLD.status = 'CLOSED' THEN
    RETURN NEW;
  END IF;

  SELECT exchanger_id INTO v_exchanger_id
    FROM cf_machine_groups WHERE id = NEW.group_id;

  -- coins ที่ตู้แลกแจก (จาก event ของ EX machine ใน session นี้)
  SELECT COALESCE(SUM(coin_meter_after - coin_meter_before), 0)
    INTO v_coins_out
    FROM cf_collection_events
   WHERE session_id = NEW.id AND machine_id = v_exchanger_id;

  -- coins ที่ตู้คีบรับ (รวมทุก CLAW ใน session)
  SELECT COALESCE(SUM(e.coin_meter_after - e.coin_meter_before), 0)
    INTO v_coins_in
    FROM cf_collection_events e
    JOIN cf_machines m ON m.id = e.machine_id
   WHERE e.session_id = NEW.id AND m.kind = 'CLAW';

  v_variance := CASE WHEN v_coins_out = 0 THEN 0
                ELSE ((v_coins_in - v_coins_out) * 10000 / v_coins_out) END;

  NEW.exchanger_coins_out := v_coins_out;
  NEW.claw_coins_in       := v_coins_in;
  NEW.coin_variance_bps   := v_variance;

  IF ABS(v_variance) > v_tolerance THEN
    NEW.status := 'ANOMALY_REVIEW';
    NEW.anomaly_flags := array_append(NEW.anomaly_flags, 'COIN_GROUP_MISMATCH');
  END IF;

  -- G2 check: ตู้แลกแจก >0 แต่ตู้คีบ = 0 → BLOCK
  IF v_coins_out > 0 AND v_coins_in = 0 THEN
    RAISE EXCEPTION 'G2: ตู้แลกแจก % เหรียญ แต่ตู้คีบรับ 0 (เป็นไปไม่ได้)', v_coins_out;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER cf_session_close_crosscheck_trg
  BEFORE UPDATE ON cf_collection_sessions
  FOR EACH ROW EXECUTE FUNCTION cf_session_close_crosscheck();
```

### 8.4 Indexes ที่ต้องมีก่อน prod

```sql
-- cross-check hot path
CREATE INDEX cf_events_session_kind_idx ON cf_collection_events(session_id)
  INCLUDE (machine_id, coin_meter_before, coin_meter_after);

-- anomaly dashboard
CREATE INDEX cf_sessions_anomaly_idx ON cf_collection_sessions(org_id, status, closed_at DESC)
  WHERE status = 'ANOMALY_REVIEW';

-- photo retention cron
CREATE INDEX cf_events_photo_purge_idx ON cf_collection_events(created_at)
  WHERE photo_meter_before_url IS NOT NULL AND photos_purged_at IS NULL;

-- stock report
CREATE INDEX cf_stock_moves_branch_idx ON cf_stock_movements(org_id, branch_id, product_id, occurred_at DESC);
```

---

## 9. UX/UI

### 9.1 Design Principles

1. **กรอกง่าย ผิดยาก · มือเดียวใช้ได้**
2. **โชว์เฉพาะที่ต้องตัดสินใจ** — ✅/🟡/🔴 + action · ไม่โชว์ % exact · ไม่โชว์ diff 4 บรรทัด
3. **Sticky bottom button** (thumb zone) · safe-area-inset
4. **XL Number Keypad** custom · 64×64px · ตัวเลขใหญ่ 32pt
5. **1-tap camera** capture (`capture="environment"`)
6. **Offline-first** — IndexedDB queue · sync เมื่อเน็ตกลับ
7. **3-pane admin** (list | drawer | actions) per memory [[ceo-prefers-multi-pane-workspace]]

### 9.2 Mockups (4 หลัก)

**A) Session Overview (มือถือ)**
```
┌─────────────────────────────────┐
│ ← ชุมพวง · รอบ 14:30 · 3/11    │
│ ●●●○○○○○○○○                     │
├─────────────────────────────────┤
│ 🟢 EX-01 ตู้แลก          ✓ ตรง  │
│ 🟢 A-01  หมี             ✓     │
│ 🟡 A-02  แมว             ✓ ขาดน │
│ ⚪ A-03  คีย์โหลด        รอ    │
│ ⚪ A-04 ... A-10                │
├─────────────────────────────────┤
│   [ ปิดรอบ (ครบ 11) ]           │
└─────────────────────────────────┘
```

**B) ฟอร์มตู้คีบ (6 ช่อง · 4 รูป)**
```
┌─────────────────────────────────┐
│ ← A-03 · 🧸หมี · ฿10/ครั้ง      │
├─────────────────────────────────┤
│ 🧸 ตุ๊กตา                       │
│  ก่อนเติม [   42 ]              │
│  เติม     [   30 ]              │
│  หลังเติม [   72 ]              │
│                                 │
│ มิเตอร์ (พิมพ์แค่หลัง)          │
│  เหรียญ [   18,420 ]            │
│  ตุ๊กตา [    1,247 ]            │
│                                 │
│ เงินสด [   8,390 ]              │
│  🟡 ขาด ฿10 (ยอมรับได้)         │
│                                 │
│ 📷 รูป 4 ใบ (บังคับ)            │
│  [📷มิเตอร์][📷ในตู้]            │
│  [📷เงินสด][📷มิเตอร์หลัง]      │
│                                 │
│   [ บันทึก & ถัดไป ]            │
└─────────────────────────────────┘
```

**C) Cross-check Summary (ปิดรอบ)**
```
┌─────────────────────────────────┐
│ ปิดรอบ · 14:58 · ชุมพวง         │
│ ╔═══════════════════════════╗   │
│ ║ รายได้รอบนี้ ฿12,840 · 11 ║   │
│ ╚═══════════════════════════╝   │
│                                 │
│ 🟢 ตู้แลกแจก = ตู้คีบรับ        │
│   8,421 ≈ 8,398 (ห่าง 0.27%)    │
│                                 │
│ ตู้ที่ต้องดู                    │
│  🟡 A-02 ขาดนิด [▸]            │
│  🟡 A-07 ขาดนิด [▸]            │
│                                 │
│   [ ปิด · ส่งหัวหน้า ]          │
└─────────────────────────────────┘
```

**D) CEO Report (PC)**
```
┌───────────────────────────────────────────────────────┐
│ รีพอต [วันนี้][7วัน][เดือน] [สาขา▼] [ตู้/group▼]    │
│ ╔═ ฿128,400 · 🟡 8 รอบ · 🔴 2 alert ═╗ [⤓ CSV]      │
├───────────────────────────────────────────────────────┤
│ เวลา   สาขา ตู้   รายได้ ตุ๊กตา เหลือ สถานะ         │
│ 14:58 ชุมพวง GRP-A 12,840  50  28   🟢 ✓           │
│ 12:15 ชุมพวง A-02    945   5   12   🟡 [▸]         │
│ 10:42 พิมาย GRP-B  8,210  40  15   🟢 ✓           │
│ 09:30 พิมาย A-07    220   3    9   🔴 [▸]         │
└───────────────────────────────────────────────────────┘
                  ↑ คลิก row → drawer ขวา
```

### 9.3 Anti-patterns (ห้าม)

| # | ห้าม | เพราะ |
|---|---|---|
| 1 | `text-[10px] uppercase tracking-wide` "designer eyebrow" | อ่านไม่ออกมือถือ · ใช้ `text-sm font-medium` |
| 2 | ตาราง >10 columns | หน้าจอแตก · ใส่ drawer |
| 3 | ปุ่ม h-7 / text-[10px] pill | <44px touch ไม่ติด |
| 4 | Next/Back wizard | form 6 ช่อง scroll เดียวพอ |
| 5 | Loading block ทั้งหน้า | ใช้ skeleton + optimistic |
| 6 | Dropdown ยาวๆ filter | ใช้ filter chip toggle |
| 7 | โชว์ "expected vs actual vs diff vs %" 4 บรรทัด | โชว์แค่ status + action |
| 8 | sticky bg-inherit (per [[sticky-bg-inherit-anti-pattern]]) | ใช้ solid bg-white |

---

## 10. Stock Module

### 10.1 Flow

```
[1] รับสินค้าเข้า (จากซื้อ/DC)
    → cf_stock_movements (type=RECEIVE, qty=+N, ref_table=null)
    → ใบเสร็จ (รูป) optional

[2] เติมเข้าตู้ (จาก collection event)
    → cf_stock_movements (type=LOAD_TO_MACHINE, qty=-N, ref_table='cf_collection_events')
    → auto-create เมื่อ submit collection event ที่มี refill_qty > 0

[3] นับสต๊อกวันนี้ (จบวัน)
    → cf_stock_movements (type=COUNT_SNAPSHOT, qty=<count>, note='daily')
    → compare กับ "ที่ควรเหลือ"
    → flag S1 ถ้าต่าง >5%

[4] Adjust (manual fix)
    → cf_stock_movements (type=ADJUST, qty=±N, note='reason')
    → require หัวหน้าสาขา + audit log
```

### 10.2 สูตร "ที่ควรเหลือ"

```
expected_stock_today =
  (last_count_snapshot.qty)  // base
  + SUM(RECEIVE qty between last_count and now)
  - SUM(LOAD_TO_MACHINE qty between last_count and now)
  + SUM(ADJUST qty between last_count and now)
```

---

## 11. Photo Pipeline

### 11.1 Upload Flow

```
client (mobile, 1-tap camera)
  → browser-image-compression (npm)
     - max 1080px (longer side)
     - WebP quality 0.75
     - strip EXIF (privacy + size)
     - target ~80-150KB
  → POST /api/clawfleet/upload (multipart)
  → server validate: auth + size <500KB + type=image/webp
  → sharp re-encode (กัน bypass)
  → R2 putObject
  → return { url, key }
client → save url to form state → submit collection event
```

### 11.2 R2 Path

```
clawfleet/{orgId}/{yyyy-mm}/{machineCode}/{eventId}/{phase}.webp

phase = meter_before | cash | meter_after | stock
```

### 11.3 Retention Cron (30 วัน)

```
Schedule: Vercel cron daily 02:00 ICT
Route: /api/cron/clawfleet-photo-retention

Query:
  SELECT id, photo_*_url FROM cf_collection_events
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND photos_purged_at IS NULL
    AND status = 'LOCKED'  -- กัน lose evidence ของ ANOMALY_REVIEW
  LIMIT 1000;

For each row:
  R2 DeleteObjects (batch up to 1000)
  UPDATE cf_collection_events
    SET photo_*_url = NULL, photos_purged_at = NOW()
    WHERE id = ANY($ids);

Audit: log count + bytes freed
```

### 11.4 Storage Estimate

| Item | Math | Total |
|---|---|---|
| Photos/session | 44 รูป (11 ตู้ × 4) | - |
| Sessions/day | 100 ตู้ / 11 = ~10 sessions | - |
| Photos/day | 440 รูป × 100KB | ~44MB |
| Rolling 30 days | 44MB × 30 | **1.3GB** |
| R2 free tier | - | 10GB ✓ |

---

## 12. Roles & Permissions

| Pool Role | ClawFleet สิทธิ์ | RLS scope |
|---|---|---|
| `SUPER_ADMIN` | ทุกอย่าง · ตั้ง threshold · เพิ่ม/ลบสาขา/ตู้ · approve >30 วัน | org_id = current_org_id() OR is_super_admin() |
| `BRANCH_MANAGER` | review anomaly · approve flag · setup loadout · นับสต๊อก สาขาตัวเอง | + UserBranch membership check (app layer) |
| `STAFF` (filler) | scan + collect · ดูรอบตัวเอง 7 วัน · แก้ <30 นาที | + UserBranch check + own session only |
| `ACCOUNTANT` (optional) | ดู report · export CSV · ปิดเดือน · ไม่แก้ data | org_id = current_org_id() |

**Audit log บังคับ** (per memory [[role-rank-privilege-escalation-guard]]):
- ทุก mutation บน `cf_collection_events`, `cf_machine_loadouts`, `cf_stock_movements`, user management
- ใช้ `canManageMachine()`, `canApproveAnomaly()` helpers (ไม่ใช่แค่ `requireRole(admin)`)

---

## 13. Route Structure

```
app/(admin)/clawfleet/
├── dashboard/page.tsx               # KPI: รายรับ · anomaly · stock alert
├── machines/page.tsx                # list + filter
├── machines/new/page.tsx            # create (กรอก initial meter)
├── machines/[code]/page.tsx         # detail + history
├── machines/[code]/edit/page.tsx
├── groups/page.tsx
├── groups/[id]/page.tsx             # 1 EX + N CLAW config
├── sessions/page.tsx                # list session (filter status/date)
├── sessions/new/page.tsx            # เลือก group → start session
├── sessions/[id]/page.tsx           # detail + cross-check + review
├── sessions/[id]/collect/[machineCode]/page.tsx  # ฟอร์มกรอกตู้
├── stock/movements/page.tsx         # รายการ stock in/out
├── stock/receive/page.tsx           # รับสินค้าเข้า
├── stock/count/page.tsx             # นับวันนี้
├── reports/page.tsx                 # หน้าเดียว + drawer
├── products/page.tsx                # CRUD สินค้า
└── settings/page.tsx                # threshold · promo · retention

API (เฉพาะที่ Server Action ทำไม่ได้):
/api/clawfleet/upload                # multipart photo upload
/api/cron/clawfleet-photo-retention  # daily cron
/api/cron/clawfleet-session-autoclose # cron auto-close 24h+ sessions
```

---

## 14. Phase Plan

| # | Phase | Days | Deliverable | Risk |
|---|---|---|---|---|
| P0 | Foundation | 1.0 | 9 tables + Prisma + migration SQL + RLS + nav `clawfleet` + seed (10 สาขา + 5 products) | drift |
| P1a | Master CRUD | 1.0 | machines + products + loadout admin | low |
| P1b | Group config + initial meter | 1.0 | group entity · machine→group FK · initial meter UI | medium |
| P2a | Session shell + form + photo | 1.0 | session open/close · ฟอร์ม 7 fields · 4-photo upload + client resize | upload speed |
| P2b | Auto-prefill + cross-check | 1.5 | prefill มิเตอร์ + cross-check trigger SQL + 9 G-rules + ANOMALY_REVIEW flow | **HIGH novel** |
| P3 | Stock + Report | 1.0 | stock module (รับ+นับ) + report 1 หน้า + drawer | low |
| P4 | Retention cron + polish | 0.5 | photo retention 30d + auto-close 24h + mobile QA | cron schedule |
| P5 | Verification gate | 0.5 | tsc + build + curl + E2E 1 session + killswitch ENV | required |
| Buffer | - | 0.5-1.0 | unblock surprise | high spend |
| **Total** | | **8-9** | | |

**Critical path:** P0 → P1a → P1b → P2a → P2b → P5 (6.5 วัน)
**Parallel possible:** P3 ขนาน P2b ถ้ามี 2 dev (ที่นี่คนเดียว · sequential)

---

## 15. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Cross-check timing (เก็บตู้แลกก่อนตู้คีบไกล) | High | High | Tolerance window ±15 min ใน UI · trigger ใช้ event ที่อยู่ใน session เดียวกัน |
| R2 | Prisma schema drift ([[pool-schema-drift-2026-05-21]]) | High | High | บังคับ surgical psql apply · `prisma migrate diff` · ห้าม `--accept-data-loss` |
| R3 | Photo 4G ช้า (44รูป × 100KB = 4.4MB) | Med | High | Client-resize + parallel 4 uploads + offline queue |
| R4 | Session race (2 พนักงาน เปิด group เดียวกัน) | Med | Med | DB unique `(group_id, status=OPEN)` · UI "X กำลังทำ" |
| R5 | Initial meter ตู้เก่าไม่มีค่า | High | Med | P1b UI กรอกมือ + CSV import optional · flag "ครั้งแรก" · skip cross-check รอบนั้น |
| R6 | พนักงานต่อต้าน UI ใหม่ (ชิน Sheets) | Med | High | Pilot 1 สาขา 1 พนักงาน 3 วัน · ขนาน Sheets 1 เดือน · คู่มือ 1 หน้า PDF |
| R7 | Group flex (5/10/N) schema rigid | Med | Med | FK ตรง · UI render N rows · ห้าม hardcode count 10 |

---

## 16. Pre-launch Checklist

### Tech (memory [[feedback-real-world-verification]])
- [ ] `npx tsc --noEmit` clean
- [ ] `npx next build` ของ Pool ผ่าน
- [ ] `npx prisma validate` + `prisma db pull` no drift
- [ ] `curl -sI` `/clawfleet/*` returns 200/401

### Data
- [ ] Seed 10 สาขา + 1 group/สาขา + 11 ตู้/group + 5 products
- [ ] Initial meter ทุกตู้ (กรอกมือ หรือ import CSV)
- [ ] 1 test session E2E (open→form→photo→cross-check→close)

### Security (memory [[role-rank-privilege-escalation-guard]])
- [ ] Pen-test RLS — user สาขา B ไม่เห็นสาขา A
- [ ] User management ใช้ `canManageUser` (ไม่ใช่แค่ `requireRole`)
- [ ] R2 URLs = signed (1hr expire) · ไม่ใช่ public

### Performance (QA)
- [ ] Upload 44 รูปบน 4G จริง < 3 นาที
- [ ] Concurrent 10 sessions ตอนปิดร้าน · ไม่ deadlock
- [ ] Cron retention dry-run บน staging

### Pilot
- [ ] 1 สาขา + 1 พนักงาน + หัวหน้า + CEO ใช้จริง **3 วัน**
- [ ] เก็บ feedback · ปรับ
- [ ] ขยาย 3 สาขา week 2
- [ ] ครบ 10 สาขา week 4

### Safety
- [ ] Database snapshot ก่อน launch (Supabase PITR)
- [ ] `MODULES_DISABLED=clawfleet` killswitch (memory [[modules-disabled-env-killswitch]])
- [ ] Rollback SQL ready (`docs/clawfleet-rollback.sql`)
- [ ] LINE group + hotline + on-call ระหว่าง pilot week

### Docs
- [ ] คู่มือพนักงาน 1 หน้า PDF (Thai + screenshot)
- [ ] Training call 15 นาที/คน

---

## 17. Decisions Pending

CEO ตอบ D1-D10 ก่อน → ผมเริ่ม P0 ได้ทันที (ไม่ตอบ = ใช้ default ที่ผมเสนอ)

| # | Decision | ผมแนะนำ (default) | Alternative |
|---|---|---|---|
| **D1** | ใคร setup loadout? | หัวหน้าสาขา + CEO override | CEO เท่านั้น |
| **D2** | ใครเริ่ม/ปิด session? | พนักงานเอง · หัวหน้า review after | หัวหน้า approve ก่อน |
| **D3** | Session ค้างกี่ชั่วโมง? | 24 ชม. + auto-close cron 06:00 | 8 ชม. |
| **D4** | Promo template? | JSON ใน `cf_exchanger_loadouts.promo_tiers` | hard-code 100/11 เท่านั้น |
| **D5** | ถ่ายรูปไม่ได้? | บังคับ 4 ใบ · ถ้าไม่ได้ → mark "ตู้เสีย" (G9) | optional skip + reason |
| **D6** | Cross-check tolerance? | 5% (settings-configurable) | 3% / 7% |
| **D7** | Group flex 5/10/N? | flex N ตั้งแต่ MVP | lock 11 ตู้ MVP |
| **D8** | Retention 30 วัน — ลบยังไง? | ลบเฉพาะ status=LOCKED + add `photos_purged_at` | ลบหมดไม่สน status |
| **D9** | Migration จาก Sheets? | เริ่มสะอาด + 1 initial event/ตู้ · Sheets link read-only | import historical |
| **D10** | Module slug? | `clawfleet` | `claw` / Thai |

---

## 18. Open Questions

ตอบทีหลังก็ได้ · ไม่ block P0

| # | Q | กระทบ |
|---|---|---|
| Q1 | ใครซื้อสินค้าเข้าคลัง (CEO/DC/สาขา)? | stock workflow |
| Q2 | บางสาขามีตู้แลก 2 ตัว — รองรับยังไง? | group config flex |
| Q3 | ตู้แลกเสีย แต่ตู้คีบใช้ได้ — เก็บยังไง? | G9 mode |
| Q4 | ผู้ใช้กดลบรูปก่อน 30 วัน? | RLS + audit |
| Q5 | ราคา/ครั้งเปลี่ยน — track history? | machine_loadouts effective period |
| Q6 | ตู้คีบบางตู้มี 2 ชั้น (บน/ล่าง) — share มิเตอร์? | machine model (อาจ split เป็น 2 machines) |
| Q7 | เก็บค่าน้ำมัน/ค่าซ่อม/ค่าเช่าตู้? | นอก ClawFleet · ไป CashHub (Pool มีอยู่) |

---

## 19. Glossary

| ศัพท์ | ความหมาย |
|---|---|
| **ตู้คีบ (Claw)** | ตู้เกมหยอดเหรียญ คีบตุ๊กตา/ของรางวัล |
| **ตู้แลก (Exchanger)** | ตู้รับธนบัตร แจกเหรียญ |
| **Group** | 1 ตู้แลก + N ตู้คีบ (ปกติ 10) ที่ใช้เหรียญร่วมกัน |
| **Session** | รอบเก็บเงิน 1 group (เก็บพร้อมกันทั้งกลุ่ม) |
| **Loadout** | สินค้า + ราคา/ครั้ง ของตู้คีบ ณ ช่วงเวลา |
| **Promo tiers** | โปรโมชั่นแลกเงิน → เหรียญ (เช่น 100฿/11) |
| **Cross-check** | เปรียบเทียบเหรียญตู้แลกแจก vs เหรียญตู้คีบรับ |
| **Initial meter** | มิเตอร์เริ่มต้นตอน setup ตู้ใหม่ |
| **Anomaly review** | session ที่ flag · รอ approve โดยหัวหน้า |
| **Continuity** | มิเตอร์ "ก่อน" รอบนี้ = "หลัง" รอบก่อน |
| **bps (basis points)** | 100 bps = 1% · 500 bps = 5% (ใช้เก็บ variance ใน DB) |

---

## 20. Appendix

### A. Sheets ปัจจุบัน (CEO ส่งมา · reference only)

1. ชุมพวง: `docs.google.com/spreadsheets/d/1-mUOVWKXNrM5VcaSDhhQdT1zHuPKhZgndzdpOAPGP4g`
2. แคนดง: `docs.google.com/spreadsheets/d/1eIrtwXWm-dovkG4tecqa8zMkljm7D0nxS5RwGMrzRf4`
3. DC stock: `docs.google.com/spreadsheets/d/1HsimFqSCQshGQ4SlInKK7Vv1fvP2ps8WrWRl68pXOJo`
4. จักราชโนนคอย: `docs.google.com/spreadsheets/d/1WM38QgcOExlzAm_XkZzWC0stw67Tr7l5vV_iTmV0hWI`
5. ภายนอก/รวม: `docs.google.com/spreadsheets/d/1E6OplvzJBJ1BnWN56zScKLIed7XIr3a8Pk2265bmxRc`
6. DC TEST: `docs.google.com/spreadsheets/d/1opeqtJ8b8y8ehMbuNyDD7c-KYTucpttU1r2wIrGyKhE`

### B. Files in Pool repo to read first (SA confirmed)

| ไฟล์ | ใช้เป็น template |
|---|---|
| `prisma/schema.prisma:1397-1593` | Repair module models |
| `supabase/migrations/20260520000005_repair_module.sql` | RLS + RPC pattern |
| `supabase/migrations/20260504000001_rls_and_jwt_claim.sql:8-30` | `current_org_id()` + `is_super_admin()` |
| `lib/modules.ts` | module registration + nav |
| `lib/r2/upload.ts` + `client.ts` | R2 upload helper |
| `lib/auth/role-guards.ts` | `canManageUser` etc |
| `lib/auth/session.ts` | `getSession()` with React `cache()` |
| `lib/repair/actions.ts` | server-action pattern |
| `app/api/docuflow/upload/route.ts` | upload route pattern |

### C. Memories ที่ relevant ตอน implement

- [[pool-schema-drift-2026-05-21]] — Prisma drift gotcha
- [[role-rank-privilege-escalation-guard]] — role guard pattern
- [[sticky-bg-inherit-anti-pattern]] — sticky cell bg
- [[sticky-thead-pattern]] — table header
- [[react-cache-on-getsession-pattern]] — perf
- [[pool-csv-import-must-diff-before-write]] — CSV import safety
- [[feedback-real-world-verification]] — verification gate
- [[modules-disabled-env-killswitch]] — emergency shutoff
- [[ceo-prefers-manual-ai-triggers]] — no auto AI
- [[ceo-prefers-multi-pane-workspace]] — 3-pane UX
- [[feedback-push-not-equals-deploy]] — push ≠ deploy
- [[chairops-vs-clawfleet-separate]] — ห้าม merge กับ ChairOps

### D. Document version history

| Version | Date | Changes |
|---|---|---|
| v1 | 2026-05-21 | Initial plan · SaaS + OCR + PIN · 17-18 วัน |
| **v2** | 2026-05-21 | **MVP rescope** · ตัด SaaS/OCR/PIN/wizard · เพิ่ม group + stock + retention · 8-9 วัน · 32 rules + 7 มุมประชุม |

---

**End of Master Plan v2.**

> ขั้นต่อไป: CEO อ่าน · ตอบ D1-D10 (หรือ accept default) · ผมเริ่ม P0
