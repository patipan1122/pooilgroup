# ClawFleet — ระบบบริหารตู้คีบตุ๊กตา

> **Status:** Planning · awaiting CEO approve เริ่ม P0
> **Created:** 2026-05-21 · จากการประชุมทีม virtual (BA+QA / SA / UX)
> **Module slug:** `clawfleet`
> **Path:** `app/(admin)/clawfleet/*` · `lib/clawfleet/*`

---

## 0. Context + Decisions (CEO answered 2026-05-21)

| Decision | เลือก | Impact |
|---|---|---|
| Deploy where | Pool legacy stack (module ใหม่) | -3 วัน · reuse admin shell + RLS + R2 |
| Tenant scope | **SaaS multi-tenant** (เผื่อขายต่อ) | +4-5 วัน signup/onboarding/billing prep |
| Filler auth | **PIN 6 หลัก** + email | ต้อง bcrypt PIN + rate-limit + lockout 5 ครั้ง + audit |
| Photo + OCR | **4 รูปบังคับ + Claude vision OCR pre-fill** | ~฿900/เดือน @ 100 ตู้/วัน · ต้อง budget guard |

**Total effort:** ~17-18 วัน (5 phases + SaaS onboarding)

**Customer profile:** เริ่ม customer แรก = ของ CEO เอง · 10+ สาขา (ชุมพวง, ขอนแก่น, ลำทะเมนชัย, พิมาย, ตลาดแค, จักราชโนนคอย, แคนดง, โนนแดง, ประทาย, เมืองยาง, ปั้ม 62) · 100+ ตู้

---

## 1. Pain ปัจจุบัน (จาก Google Sheets ของ CEO)

- **ข้อมูลกระจาย:** 1 sheet/สาขา → CEO ดูภาพรวมไม่ได้
- **กรอกผิดเยอะ:** มิเตอร์ 4-6 หลัก · พิมพ์ผิดจุดเดียวรันยาวพังหมด
- **ไม่มี validation:** ไม่ cross-check เงิน vs มิเตอร์ vs สต๊อก
- **ดูยาก:** หาตู้น่าสงสัย/พนักงานน่าสงสัยไม่ได้
- **Stock จาก DC ไปสาขา:** ไม่มี variance tracking · "ขาด/เกิน" หาสาเหตุยาก

---

## 2. กฎ "กันโง่" 4 ชั้น (หัวใจของระบบ)

### 2.1 Continuity (C1-C4) — มิเตอร์ต่อเนื่อง
- **C1:** มิเตอร์ก่อน (รอบนี้) = มิเตอร์หลัง (รอบก่อน) · **flag CRITICAL** ถ้าไม่ตรง (ไม่ block — บางครั้งช่างเปลี่ยน main board)
- **C2:** มิเตอร์หลัง ≥ มิเตอร์ก่อน (ทุกมิเตอร์) · **BLOCK** ถ้า violation
- **C3:** วันที่รอบนี้ ≥ วันที่รอบก่อน · **BLOCK**
- **C4:** stock หลังเติม ≥ stock ก่อนเติม (ถ้าเติม) · WARN

### 2.2 Money (M1-M5) — เงินตรงมิเตอร์
- **M1:** |เงินสด - ที่ควรได้| ≤ ฿20 · ผ่าน
- **M2:** ขาด ฿20-฿100 · WARN เหลือง + บันทึก
- **M3:** ขาด >฿100 หรือ >5% · BLOCK + ใส่เหตุผล + หัวหน้า approve
- **M4:** เกิน >฿50 · WARN (เหรียญทดสอบ?)
- **M5:** มิเตอร์ไม่ขยับแต่มีเงิน · BLOCK (มิเตอร์เสีย?)

### 2.3 Product (P1-P6) — ตุ๊กตาตรงสต๊อก
- **P1:** (ก่อน + เติม) - หลัง = ตุ๊กตาตามมิเตอร์ · ผ่าน
- **P2:** ต่าง 1-2 ตัว · WARN
- **P3:** ต่าง >2 ตัว หรือ >10% · BLOCK (ขโมย/มิเตอร์เพี้ยน)
- **P4:** ตุ๊กตามิเตอร์ขยับ แต่เหรียญไม่ขยับ · BLOCK (ตู้แจกฟรี?)
- **P5:** เหรียญขยับเยอะ แต่ตุ๊กตาไม่ออก · WARN (ตู้คีบยากเกิน)
- **P6:** stock หลังเติม > capacity · BLOCK

### 2.4 Anomaly (A1-A4) — เทียบ baseline
- **A1:** รายได้รอบนี้ < 20% ของ avg 30 วัน · WARN
- **A2:** รายได้รอบนี้ > 300% ของ avg · WARN (จริงหรือกรอกผิด?)
- **A3:** ตู้เดียวกัน เก็บ 2 รอบใน 1 วัน · WARN + ระบุเหตุผล
- **A4:** พนักงานคนเดียว flag M3/P3 > 3 ครั้งใน 7 วัน · **ALERT CEO** (audit)

---

## 3. Data Model (10 tables · prefix `cf_`)

```
Organization (มีอยู่)
  └─ Branch (มีอยู่)
       └─ Machine (cf_machines) ─┬─ MachineLoadout (cf_machine_loadouts)
                                  ├─ CollectionEvent (cf_collection_events) ⭐ fact table
                                  │     ├─ CollectionRefillLine (cf_collection_refill_lines)
                                  │     └─ MeterAnomaly (cf_meter_anomalies)
                                  └─ MachineStatusLog (cf_machine_status_logs)

Product (cf_products) ── อ้างอิงจาก loadout + refill line + transfer
Branch ──┬─ BranchStockSnapshot (cf_branch_stock_snapshots)
         └─ StockTransfer (cf_stock_transfers) ── StockTransferItem (cf_stock_transfer_items)
```

**Key columns ใน `cf_collection_events` (fact table):**
- มิเตอร์เหรียญ before/after
- เงินสดที่นับ
- มิเตอร์ตุ๊กตา before/after
- สต๊อกในตู้ before/after
- จำนวนเติม
- **Generated columns** (Postgres `GENERATED ALWAYS AS ... STORED`):
  - `expected_revenue_cents` = (coinAfter - coinBefore) × coinValue
  - `cash_variance_cents` = cashCounted - expectedRevenue
  - `doll_issued_actual` = dollMeterAfter - dollMeterBefore
  - `doll_issued_physical` = (stockBefore + refillQty) - stockAfter
  - `doll_variance` = physical - actual
- รูป 4 URL: photoMeterBeforeUrl, photoCashUrl, photoMeterAfterUrl, photoStockUrl
- status: DRAFT / SUBMITTED / LOCKED / VOIDED

**Continuity 3 ชั้น:**
1. App layer prefill จาก `cf_machines.last_*` mirror (ลด typo 95%)
2. Postgres CHECK monotonic
3. BEFORE INSERT trigger → flag CONTINUITY_BREAK ถ้าไม่ต่อจากรอบก่อน (ไม่ block)
4. AFTER INSERT trigger → update mirror counters ใน `cf_machines`

---

## 4. Roles + Permissions

Mapping Pool `UserRole` enum:

| Pool Role | ClawFleet สิทธิ์ |
|---|---|
| `SUPER_ADMIN` / `CEO` | เห็น/แก้ทุกอย่าง · clear anomaly · void event · approve >7 วัน |
| `BRANCH_MANAGER` | เห็นทุกตู้ใน branch · approve anomaly · ดู report สาขา · approve <7 วัน |
| `STAFF` (filler) | scan + collect · ดูรอบตัวเอง 7 วัน · แก้ <30 นาที |
| `DC_STAFF` | สร้าง transfer · รับคืน · นับ DC stock |
| `DC_MANAGER` | approve discrepancy · adjust stock master |

Branch filtering ใน app layer ผ่าน `lib/clawfleet/role-guard.ts` (ใช้ `UserBranch` ที่มีอยู่)

---

## 5. Route Structure

```
app/(admin)/clawfleet/
├── dashboard/page.tsx              # KPI overview
├── machines/page.tsx               # list + filter
├── machines/[code]/page.tsx        # detail + trend
├── machines/[code]/collect/page.tsx ⭐ wizard mobile (PIN auth)
├── machines/[code]/history/page.tsx
├── branches/[code]/page.tsx
├── branches/[code]/stock/page.tsx
├── stock/transfers/page.tsx
├── stock/transfers/new/page.tsx
├── stock/transfers/[code]/page.tsx
├── stock/products/page.tsx
├── reports/revenue/page.tsx
├── reports/variance/page.tsx
├── reports/machines/page.tsx       # top/bottom 10
└── settings/page.tsx               # validation thresholds

app/clawfleet-pin/                   # PIN-only filler entry (no admin shell)
├── login/page.tsx
└── [machine-code]/collect/page.tsx
```

API routes:
- `/api/clawfleet/upload` — R2 รูป
- `/api/clawfleet/ocr` — Claude vision (manual trigger only · per memory ceo-prefers-manual-ai-triggers)
- `/api/clawfleet/pin-auth` — PIN login (rate-limit + lockout)

---

## 6. SaaS Onboarding (เพิ่มจาก Pool base)

เพราะเลือก multi-tenant SaaS · ต้องเพิ่ม:

- `/clawfleet-signup` — landing + signup (CEO ขายแอปนี้ให้ลูกค้ารายอื่น)
- Tenant onboarding wizard:
  1. Org name + จำนวนสาขา
  2. สร้างสาขาแรก
  3. สร้างตู้แรก (พร้อม seed loadout)
  4. Invite พนักงานคนแรก (gen PIN)
  5. Demo data toggle (ใส่ตู้สาธิต)
- Billing prep (Stripe ภายหลัง · ช่วงแรก trial 30 วัน)
- Subdomain: `<tenant-slug>.clawfleet.app` (ถ้า CEO ซื้อ domain) หรือใช้ path `/t/<slug>/` ก่อน

---

## 7. Phase Plan (~17-18 วัน)

| # | Phase | Scope | วัน | Deliverable |
|---|---|---|---|---|
| **P0** | Foundation | Prisma 10 tables + migration SQL + RLS + seed + nav register + `lib/modules.ts` | **2** | DB live · empty admin page เปิดได้ |
| **P1** | Master CRUD | machines · products · loadout · branches view · role-guard · CSV import | **2.5** | สร้าง/แก้/ดู ตู้+สินค้า ได้ |
| **P2** | Wizard ⭐ | Mobile wizard 8 step · photo R2 · continuity trigger · OCR endpoint · PIN auth · auto-save | **4** | พนักงานกรอกรอบเก็บเงินได้ end-to-end |
| **P3** | Dashboard + reports | revenue/variance/anomaly · CSV export · machine top/bottom · filler leaderboard | **2.5** | CEO ดู KPI ได้ |
| **P4** | Stock + DC ops | transfer create/accept · branch snapshot · variance · CSV import diff-before-write | **2.5** | DC ส่ง/รับสินค้าได้ |
| **P5** | SaaS onboarding | signup · tenant wizard · demo data · subdomain/path · Stripe prep | **3** | ลูกค้าใหม่ self-signup ได้ |
| **P6** | Polish | role QA · sticky thead · Telegram alert · OCR budget guard · settings page | **1.5** | Production-ready |

**Critical path:** P0 → P1 → P2. ทำ P2 ก่อน P3/P4/P5 เสมอ.

---

## 8. ความเสี่ยง + Mitigation

| ความเสี่ยง | Mitigation |
|---|---|
| Prisma drift กับ generated columns | Apply ด้วย surgical SQL หลัง `prisma db push` · per memory `pool-schema-drift-2026-05-21` |
| OCR cost ปลายเปิด | Budget guard ใน `lib/clawfleet/ocr.ts` · cap ฿1500/เดือน/org · fallback manual |
| PIN brute force | Rate-limit 5 ครั้ง/15 นาที/IP · lockout account 30 นาที หลัง 5 fails · log ทุก attempt |
| รูปกินที่ R2 | Auto-resize 1080px · WebP · ลบ photo ของ event LOCKED >180 วัน |
| Migration จาก Google Sheets | สร้าง CSV import tool ใน P4 · diff-before-write บังคับ (memory) |
| พนักงานหา way around | Audit log + 4 รูปบังคับ + settings thresholds CEO config ได้ |

---

## 9. Open Questions (ตอบทีหลังก็ได้)

- ราคา/ครั้งของแต่ละตู้ตอนนี้ = ฿10 ทุกตู้ หรือต่างกัน?
- บางตู้มี 2 ชั้น (บน/ล่าง) — share มิเตอร์ตุ๊กตา หรือแยก?
- มีเก็บค่าซ่อม/ค่าน้ำมัน/ค่าเช่าตู้ ตอนนี้ที่ไหน? — รวมใน ClawFleet หรือ Pool CashHub?
- ความถี่เก็บเงิน — ทุกวัน หรือ 2-3 วันครั้ง?
- Trial 30 วันสำหรับ SaaS — กี่ตู้/สาขาให้ฟรี? (limit ทรัพยากร)

---

## 10. ต่อจะทำอะไรขั้นต่อไป

**รอ CEO บอก:**
- (ก) "ลุยเลย P0" → ผมสร้าง Prisma models + migration + RLS + nav register · ใช้ ~2 วันจริง · turn เดียวทำไม่จบ ทำเป็น batch
- (ข) "อ่าน plan ก่อน · นอนคิด" → ผมรอ
- (ค) "ปรับ scope ก่อน" → CEO บอกอะไรเพิ่ม/ลด ผมอัพเดต plan

**ไฟล์ที่จะแก้ใน P0 (ถ้า CEO บอก ลุย):**
- ✏️ สร้างใหม่: `prisma/schema.prisma` (+ 10 models prefix `cf_*`)
- ✏️ สร้างใหม่: `supabase/migrations/20260521000000_clawfleet_module.sql` (DDL + RLS + triggers + generated columns + event code generator)
- 🔧 แก้ไข: `lib/modules.ts` (+ register `clawfleet` module)
- ✏️ สร้างใหม่: `app/(admin)/clawfleet/layout.tsx` (module shell)
- ✏️ สร้างใหม่: `app/(admin)/clawfleet/dashboard/page.tsx` (placeholder)
- ✏️ สร้างใหม่: `lib/clawfleet/role-guard.ts`
- ✏️ สร้างใหม่: `db/seed/clawfleet-seed.ts` (10 สาขา + 5 product category demo)

**ตรวจกับสิ่งที่อยู่:**
- ✅ ไม่ชน auth (reuse Pool session)
- ✅ ไม่ชน RLS (org_id pattern เดิม · helper `current_org_id()`)
- ✅ ไม่ชน schema เดิม (prefix `cf_*` แยก namespace)
- ✅ ไม่ชน routes เดิม (path `/clawfleet/*` ว่าง)

---

## Appendix: ลิงก์ Sheets ปัจจุบัน (อ้างอิง · จะ import ใน P4)

1. ชุมพวง: docs.google.com/spreadsheets/d/1-mUOVWKXNrM5VcaSDhhQdT1zHuPKhZgndzdpOAPGP4g
2. แคนดง: docs.google.com/spreadsheets/d/1eIrtwXWm-dovkG4tecqa8zMkljm7D0nxS5RwGMrzRf4
3. DC stock master: docs.google.com/spreadsheets/d/1HsimFqSCQshGQ4SlInKK7Vv1fvP2ps8WrWRl68pXOJo
4. จักราชโนนคอย: docs.google.com/spreadsheets/d/1WM38QgcOExlzAm_XkZzWC0stw67Tr7l5vV_iTmV0hWI
5. (ภายนอก/รวม): docs.google.com/spreadsheets/d/1E6OplvzJBJ1BnWN56zScKLIed7XIr3a8Pk2265bmxRc
6. DC TEST: docs.google.com/spreadsheets/d/1opeqtJ8b8y8ehMbuNyDD7c-KYTucpttU1r2wIrGyKhE
