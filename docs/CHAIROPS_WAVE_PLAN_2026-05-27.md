# ChairOps · Wave Plan (Full Ship)

> **Created:** 2026-05-27 · **Owner:** Pattipan (CEO) · **Sign-off:** pending per wave
> **Source decisions:** `[[chairops-p0-decisions-locked-2026-05-27]]` · audit `docs/AUDIT_chairops_2026-05-25.md`
> **Mode:** Full ship (CEO chose Q4=a · ลุยเต็ม) · ship in 4 waves with CEO approval gate each
> **Scope rule:** ChairOps only — do NOT touch Playland · ClawFleet · Recruit · CashHub · Repair · Buildly Go

---

## 🎯 Goal of this document

แสดงแผนงาน ChairOps ครบ 4 phase ในเอกสารเดียว · CEO อนุมัติทีละ wave ก่อนลุยต่อ · ทุกคนเห็น roadmap เดียวกัน · ป้องกัน scope creep · มี safety net หยุดได้ทุก checkpoint

---

## 📊 สรุปรอบเดียว (CEO Briefing)

| Wave | จุดประสงค์ | เวลาประมาณ | Critical output |
|---|---|---|---|
| **0** | Fix risks live บน prod + upload flow ใช้ได้จริง | 3-4 วัน | ระบบปลอดภัย · CEO อัพ XLSX แล้วเห็นยอด/สาขา/วัน |
| **1** | Maid + Office full daily flow | 5-7 วัน | แม่บ้าน LINE OA → กรอกฟอร์ม · หลังบ้านเห็น dashboard · ปิดเงินครบ |
| **2** | Vendor bills + accounting export | 4-6 วัน | บิลห้างอัตโนมัติ · บัญชี import ได้เดือนแรก |
| **3** | Polish + advanced features | 3-4 วัน | Audit polish · advanced filters · KPI delight |

**รวม 15-21 วันทำงาน** (~3-4 อาทิตย์)

---

## 🛠 Wave 0 · Foundation Fix (3-4 วัน)

> **เป้า:** ChairOps live บน prod อยู่ตอนนี้ มี 5 risks ที่อันตราย · ปิดให้หมดก่อนใส่ feature ใหม่
> **CEO acceptance:** ระบบไม่หลุดเงิน · cron ทำงาน · upload XLSX แล้วเห็นยอด

### W0.1 · Fix 5 Critical Risks (จาก audit)

| # | Risk | Fix |
|---|---|---|
| 1 | **Drift engine คำนวณ lifetime-sum** | เปลี่ยนเป็น **daily-window** (per `[[chairops-starthing-xlsx-schema-2026-05-27]]` เพราะไม่มี timestamp) — drift = collected - cash_total_of_day(s) since last collection |
| 2 | **3 ChairOps crons ไม่ register ใน vercel.json** | เพิ่ม `recompute-drifts` · `sop-check` · `ceo-digest` ใน `vercel.json` cron block |
| 3 | **Module entitlement gate ขาด** | ทุก `app/(admin)/chairops/*/layout.tsx` ต้องเรียก `assertModuleEnabled('chairops')` + `userHasModuleAccess(user, 'chairops')` (per `[[module-entitlement-must-gate-all-layouts]]`) |
| 4 | **Auto-bootstrap admin** | ลบ "auto-create ChairopsUser ที่ derive ADMIN จาก Pool admin" → require explicit `/chairops/access-request` flow (BR12) |
| 5 | **LINE Notify EOL placeholder** | ใส่ TODO comment + กั้นไม่ให้ส่ง alert ที่ไม่ critical · เก็บ LINE Notify ไว้สำหรับ critical alerts จน Wave 1 ย้ายเป็น OA |

### W0.2 · Schema Additions

```prisma
// In ChairopsBranch — add cost + deposit
model ChairopsBranch {
  // ... existing fields ...
  monthlyRent       Decimal? @db.Decimal(12,2)
  monthlyUtility    Decimal? @db.Decimal(12,2)  // ไฟ+น้ำ+เน็ต
  monthlyStaff      Decimal? @db.Decimal(12,2)
  monthlyOther      Decimal? @db.Decimal(12,2)
  securityDeposit   Decimal? @db.Decimal(12,2)  // เงินจมที่ห้าง
}

// NEW table — aggregate per branch per day
model ChairopsBranchDailyRevenue {
  id               String   @id @default(cuid())
  orgId            String
  branchId         String
  bizDate          DateTime @db.Date
  cashTotal        Decimal  @db.Decimal(12,2)
  onlineTotal      Decimal  @db.Decimal(12,2)
  otherTotal       Decimal  @db.Decimal(12,2)  @default(0)
  grossTotal       Decimal  @db.Decimal(12,2)
  paymentCount     Int       @default(0)
  coinInsertCount  Int       @default(0)
  roundCount       Int       @default(0)
  sourceImportId   String?  // FK to ChairopsPosImport batch
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  branch           ChairopsBranch @relation(fields: [branchId], references: [id])
  @@unique([orgId, branchId, bizDate])
}
```

### W0.3 · StarThing XLSX Parser

`lib/chairops/pos-ingest/starthing-xlsx.ts`:
- Read XLSX (use `xlsx` lib already in Pool deps)
- Validate sheet name = "ข้อมูลรายได้ (ตามกรอบเวลา)" or first sheet
- Parse 20 columns into typed rows
- Match `ชื่อร้าน` → `ChairopsBranch` (exact-string first · then fuzzy if no match)
- Group by `(วันที่, branchId)` → sum `จ่ายเงินสด` + `ชำระเงินออนไลน์`
- Output: { newBranches[], dailyRows[], perChairRows[] }

### W0.4 · Upload UI (the "2-click flow")

`app/(admin)/chairops/pos-ingest/page.tsx`:
- Drag-drop XLSX
- Server: parse → show **diff preview** ("+ N new · M same · K changed" per `[[pool-csv-import-must-diff-before-write]]`)
- "branch ใหม่ที่ไม่รู้จัก: 'xyz' — สร้างหรือ map?" inline prompt
- Click "บันทึก" → commit transaction → redirect to `/chairops` exec home

### W0.5 · Verify

- `npm run build` clean
- `npm run typecheck` clean
- Manual: upload sample XLSX (1kGw3...) · verify 30 days × 8 branches written
- Re-upload same file = idempotent · no duplicates
- Old `/chairops` exec home shows new dailyTotal column

### W0 Output
- 5 risks closed
- XLSX upload works end-to-end with CEO sample
- Branch cost fields editable on `/chairops/branches/[id]`
- Net profit KPI shows: `revenue - dailyCost` per branch per day

---

## 🦋 Wave 1 · Maid + Office Daily Flow (5-7 วัน)

> **เป้า:** แม่บ้านรายงานใน LINE OA · หลังบ้านเห็น dashboard เดียว · ปิด 30 LINE groups
> **CEO acceptance:** แม่บ้าน 1 สาขา ทดลอง 1 อาทิตย์ · กรอก collect+clean+damage+supply ได้ครบ · หลังบ้านเห็นสถานะ real-time

### W1.1 · LINE OA Setup

- CEO สมัคร LINE OA Business Account (1-3 วัน · external)
- Token encrypt pattern จาก `[[recruit-omnichannel-prod-2026-05-23]]`
- Channel config table `ChairopsLineChannel` (id, orgId, channelId, encryptedToken, encryptedSecret, webhookSecret)
- Admin paste 2 secrets at `/chairops/settings/line-channel`

### W1.2 · LINE OA + LIFF Mini App

- Rich menu: [💰 เก็บเงิน] [🧹 ตรวจคลีน] [🔧 แจ้งซ่อม] [📦 เบิกของ]
- Each opens LIFF endpoint → wraps existing `/chairops/m/*` PWA route
- LIFF init checks `liff.isInClient()` → if true, prefill maid context from LINE userId mapping
- Webhook `/api/chairops/line/webhook` — HMAC verify + event router

### W1.3 · Maid PWA Full Flow

ตามที่ audit ตกลง:
- `/chairops/m/collect/new` — เก็บเงิน + photo + idempotency key + offline outbox v1 (IndexedDB)
- `/chairops/m/cleanliness` — checklist 10 ข้อ + photo + "ทุกข้อปกติ" shortcut
- `/chairops/m/damage/new` — แจ้งซ่อม + photo + urgency selector
- `/chairops/m/supply-request` — เบิกของจาก spare parts inventory
- `/chairops/m/profile` — รหัส LINE link + edit name

### W1.4 · Office Dashboard `/chairops/dashboard-office`

- 30-branch × 4-task **status grid** ✓/✗/⏳ live
- "ใครยังไม่ส่งวันนี้" panel
- LINE template button (auto-prefilled DM ผ่าน OA push)
- EOD checklist persist server action

### W1.5 · MANAGER_AREA helper

- ไม่มี user ตอนนี้ · แต่เก็บ enum + table ไว้
- `getUserAreaBranchIds(orgId, userId)` helper · returns `[]` if not assigned
- UI `/chairops/manager` redirect to `/chairops` if no area assigned

### W1.6 · Verify

- Real device test: 3 Android × 3 WiFi (รวม "ห้างชั้น 4 WiFi ขาด ๆ")
- Pilot 1 branch × 5 days · maid + office daily routine
- Acceptance: 0 LINE Notify usage by Day 5

### W1 Output
- LINE OA live · 30 maids onboarded
- 30 LINE groups muted (3-month overlap policy)
- Dashboard-office shows real-time grid
- Maids can do all 4 tasks in LIFF Mini App

---

## 💰 Wave 2 · Vendor Bills + Accounting Export (4-6 วัน)

> **เป้า:** บิลห้างเข้าระบบอัตโนมัติ · บัญชี import เดือนแรกได้
> **CEO acceptance:** เดือนเมษา 2026 บัญชี import เข้า BC/Express > 95% ไม่ re-key

### W2.1 · ChairopsVendorBill Table + UI

```prisma
model ChairopsVendorBill {
  id              String   @id @default(cuid())
  orgId           String
  branchId        String
  billPeriod      String   // "2026-04"
  issuedDate      DateTime @db.Date
  dueDate         DateTime @db.Date
  amount          Decimal  @db.Decimal(12,2)
  currency        String   @default("THB")
  status          ChairopsBillStatus  // RECEIVED/APPROVED/PAID/DISPUTED/OVERDUE
  sourceType      ChairopsBillSource  // EMAIL_AUTO/EMAIL_MANUAL/PAPER/OTHER
  sourceEmailId   String?
  pdfR2Url        String?
  extractedJSON   Json?
  lineItems       Json?     // [{description, amount, ...}]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

- `/chairops/bills` list with filters (branch, status, due-soon)
- `/chairops/bills/[id]` detail with PDF preview + approve/dispute buttons
- Manual entry form on `/chairops/bills/new` (fallback if AI miss)

### W2.2 · Gmail AI Auto-Parser Cron

- Cron `cron/chairops/bill-ingest` runs every 4 hours
- Auth: CEO grants Gmail label-read access (Service Account or OAuth user grant)
- Poll Gmail label `ChairOps/Bills` for unread messages
- Per message:
  - Download PDF attachment (max 5MB)
  - Upload to R2 (`chairops-bills/{orgId}/{yyyy-mm}/{cuid}.pdf`)
  - Call Claude Sonnet API with file ref + extraction prompt:
    > "Extract Thai mall invoice: branchHint · billPeriod (YYYY-MM) · issuedDate · dueDate · totalAmount · lineItems[]"
  - Match branchHint → ChairopsBranch (LLM-fuzzy)
  - Insert with `status=RECEIVED · sourceType=EMAIL_AUTO`
  - LINE OA push CEO: "บิลใหม่ {mall} · {amount}฿ · ครบ {dueDate}"
- **Important:** AI does NOT auto-approve (per `[[ceo-prefers-manual-ai-triggers]]`) — CEO opens link · checks · clicks APPROVE
- Audit trail: every LLM call's input+output stored forever

### W2.3 · Period-Close + Adjustment Workflow

- `ChairopsPeriod` table: orgId · year · month · status (OPEN/SOFT_CLOSED/HARD_CLOSED)
- `/chairops/periods/[YYYY-MM]` UI · CEO+ only
- Soft-close at month-end: block new POS imports without override
- Hard-close: lock everything · adjustments require AdjustmentRequest workflow
- `/chairops/adjustment/request` + `/chairops/adjustment/[id]` (CEO approve)
- `PeriodReopenLog` immutable audit trail

### W2.4 · Accounting Export

- `/chairops/audit/export/[id]` → CSV in BC/Express format
- Columns: date · branch (with account code) · debit · credit · description · ref
- Chart-of-account mapping table `ChairopsCOAMap` (CEO config)
- VAT mark + rate per branch
- Payroll deduction CSV (separate route)

### W2 Output
- Bills appear in dashboard within 4 hours of email arrival
- CEO approves 1-click · system marks PAID after bank reconcile
- Accountant import เมษา 2026 successfully

---

## 🎨 Wave 3 · Polish + Advanced (3-4 วัน)

> **เป้า:** Audit excellence · CEO delight · ready for scale
> **CEO acceptance:** Audit page useful for quarterly review · KPI สวยงาม · ระบบรู้สึก "complete"

### W3.1 · Audit-of-Auditors

- `/chairops/audit` page with 11 filter chips (entity · entityId · userEmail · action · date-range · branch · actor_kind · override-only · cron-only · JSON-path query)
- DataGrid `persistKey="audit-filters"`
- Click row → drawer with diff JSON before/after side-by-side
- Export with self-audit trail (BR6)

### W3.2 · Damage SLA + Spare Parts Inventory

- Cron `cron/chairops/damage-sla` — escalate URGENT damage tickets > 24h
- Spare parts movement ledger (in/out)
- Supply request workflow `/chairops/supply-requests` (new/approved/shipped/received)

### W3.3 · Leaderboard + Executive Polish

- `/chairops/reports/leaderboard` — top/worst 5 branches by net profit · revenue · cleanliness
- Sparkline + delta arrow on KPI tiles
- Sticky thead per `[[sticky-thead-pattern]]`
- Solid sticky bg per `[[sticky-bg-inherit-anti-pattern]]`
- Mobile responsive: KPI 2×3 on portrait

### W3.4 · LINE OA Push Templates

- EOD digest: "ขาดส่ง {N} สาขา · ยอดสะสมขาด {X}฿ · ใครต้องตาม"
- Weekly summary: "อาทิตย์นี้: รายได้ {Y}฿ · ต้นทุน {Z}฿ · กำไร {W}฿"
- CEO morning brief: 5 KPIs + 3 alerts in single LINE message

### W3 Output
- Audit trail complete + queryable
- KPIs delightful + actionable
- Ready to onboard sales / accountant / external auditor

---

## 🚦 Cross-Wave Conventions (กฏกลาง)

| Area | Rule | Source |
|---|---|---|
| Module gate | ทุก layout เรียก assertModuleEnabled+userHasModuleAccess | `[[module-entitlement-must-gate-all-layouts]]` |
| Role guard | ใช้ canAssignRole/canManageUser ไม่ใช่แค่ requireRole | `[[role-rank-privilege-escalation-guard]]` |
| Session cache | wrap getSession ด้วย React cache() | `[[react-cache-on-getsession-pattern]]` |
| Sticky bg | solid · ห้าม bg-inherit | `[[sticky-bg-inherit-anti-pattern]]` |
| Sticky thead | top-14 sm:top-16 z-20 single-table only | `[[sticky-thead-pattern]]` |
| Section eyebrow | ห้าม uppercase Thai · ห้าม tracking > 0.05em | `[[section-component-eyebrow-rootcause]]` |
| Zod UUID | ใช้ zUUID() ห้าม z.string().uuid() | `[[zod-v4-uuid-strict-rejects-seed]]` |
| CSV/XLSX import | diff preview ก่อน write | `[[pool-csv-import-must-diff-before-write]]` |
| AI features | manual trigger · ไม่ auto-commit | `[[ceo-prefers-manual-ai-triggers]]` |
| Push not deploy | git push ≠ vercel --prod | `[[feedback-push-not-equals-deploy]]` |

---

## 🛡 Safety net (กัน scope creep)

แต่ละ wave มี **3 exit criteria** · ทำไม่ครบ = stop · ห้ามเข้า wave ถัดไป

**Wave 0:**
- ✅ build/typecheck clean
- ✅ XLSX upload sample file → diff preview → commit → see in dashboard
- ✅ 5 risks ปิดจริง (re-audit checklist)

**Wave 1:**
- ✅ 1 maid 1 branch ใช้ครบ 5 วัน
- ✅ Office dashboard real-time accurate
- ✅ 0 LINE Notify usage

**Wave 2:**
- ✅ Bills appear within 4h of email
- ✅ Accountant import เมษา > 95% rows ไม่ re-key
- ✅ Period-close + adjustment lifecycle test pass

**Wave 3:**
- ✅ Audit page filters work + export self-audited
- ✅ Mobile responsive checklist pass
- ✅ KPI tiles match brand tokens

---

## 📋 Decision register (Open items as of 2026-05-27)

| ID | Question | Status |
|---|---|---|
| D-NEW-A | Cost field structure (a/b/c) | CEO leaning (b) 4-field split — confirm? |
| D-NEW-B | BR1 window mode (α/β/γ) | Default α daily-window unless CEO objects |
| D-NEW-C | Plan format (1/2/3) | Default (3) plan-all-approve-wave |
| D-NEW-D | Gmail auth: Service Account vs OAuth | Default OAuth (less infra · CEO grants once) |
| D-NEW-E | LINE OA channel: 1 channel or per-tenant? | Default 1 (CEO owns 1 ChairOps biz) |
| D-NEW-F | Security deposit history vs current? | Default current-only (one field) — add history if needed |
| D-NEW-G | Bill PDF retention years | Default 7 years (accounting standard) |

---

## 🎬 Next action

**CEO อนุมัติ Wave 0?**
- ✅ ลุย → ผมเริ่ม W0.1-W0.5 ทันที (3-4 วัน)
- 🟡 ขอแก้ → บอกตรงไหน ผมแก้ doc นี้แล้วลุย
- ❌ Hold → บอกเหตุ จะปรับ scope

---

**END · Plan version 1.0 · 2026-05-27**
