# Audit — LedgerLine → TRCloud v2 Integration
> Generated: 2026-06-07 | 15 personas (PM · BA · SA · Architect · Senior Dev · FE · BE · UX · UI · QA · QC · DevOps · Owner · FIN · AUD) | Mode: Full
> Branch: `tax-invoice` → merge target: `setup` → auto-deploy to prod
> Source of truth for the `/bigsolvebug` sprint that follows

---

## 1. Executive Summary (Thai)

ระบบ LedgerLine → TRCloud v2 Integration มีเป้าหมายให้นักบัญชี JP Sync Group สามารถ push ค่าใช้จ่ายที่พนักงานถ่ายรูปผ่าน LINE เข้า TRCloud เป็น AP (Accounts Payable) ได้อัตโนมัติ โดย **ถูกต้องตามกฎหมายภาษีและมาตรฐานบัญชีไทย** (GL code ครบ, SKU 3 รหัสมาตรฐาน, VAT claimable ถูกต้อง, company 45 ไม่ใช่ 31)

จาก audit 15 personas พบว่า **โครงสร้างหลักถูกต้องและ happy-path ทำงานได้** — ระบบ claim pattern (optimistic lock), retry button, bulk-sequential push, และ TRCloud API credentials ถูก isolate ไปยัง company 45 แล้ว อย่างไรก็ตามพบ **6 P0 bugs ที่ทำให้ข้อมูลภาษีผิดพลาดหรือ audit trail ไม่ครบ** ซึ่งต้องแก้ก่อนให้นักบัญชีใช้งานจริง: (1) `vatClaimable` default ตั้งเป็น `true` แทนที่ต้องเป็น `false` ตามหลักอนุรักษ์นิยมทางบัญชีไทย — ทำให้ VAT ที่ขอคืนไม่ได้หลุดเข้า ภ.พ.30 ทุกครั้งที่สร้าง category ใหม่, (2) หมวดหมู่ที่สร้างผ่าน add-form ไม่บันทึก `trcloudProductCode` หรือ `vatClaimable` — ทำให้ push ล้มเหลวเงียบๆ, (3) filter "ส่งแล้ว" จับแถวที่ยัง in-flight (`"pending"`) ด้วย — ทำให้ดูเหมือนส่งแล้วทั้งที่ยังไม่เสร็จ, (4) ไม่มี intent audit ก่อน HTTP call — ถ้า Vercel crash หลัง TRCloud สร้าง AP แต่ก่อนบันทึก result จะไม่รู้ว่า AP มีอยู่แล้ว, (5) `deleteTrcloudAp` ไม่มี role gate — ใครมี docId ก็ลบได้, (6) stale-pending reset ที่จะสร้างต้องตรวจสอบกับ TRCloud ก่อน ไม่ใช่ล้างทิ้งเลย ค่าใช้จ่ายในการแก้ P0 ทั้งหมดประมาณ ~80 LOC + SQL migration 1 บรรทัด

---

## 2. Scope

### IN SCOPE (this audit covers)
- `lib/ledger/trcloud-push.ts` — TRCloud API client + AP build logic
- `app/(admin)/ledger/_actions.ts` — server actions: `sendExpenseToTrcloud`, `sendExpensesToTrcloud`, `loadPushable`, `recordPushResult`, `deleteTrcloudAp`, `createCategory` (line ~407)
- `app/(admin)/ledger/queries.ts` — `getPushableExpenses`, filter logic for `sent` / `pending`
- `components/features/ledger/CategoryManager.tsx` — category add/edit form UI
- `components/features/ledger/SendToTrcloudButton.tsx` — push button + loading/error state
- `app/(admin)/ledger/settings/page.tsx` — settings hub
- Schema: `ledger_category.vat_claimable`, `ledger_category.trcloud_product_code`, `ledger_expense.trcloud_doc_id`
- Audit trail: `audit_logs` table — diff payload completeness

### OUT OF SCOPE
- TRCloud web UI internals (ไม่แตะ TRCloud side)
- LINE bot flow (receipt capture via `lib/line/`)
- Supabase RLS policies (covered in AUDIT_ledger-permissions_2026-06-05.md)
- Payment / quotation module (WORKSHOP_ledgerline-payments-quotations.md)
- WHT (ภาษีหัก ณ ที่จ่าย) per-category calculation — deferred
- Multi-company support (beyond JPS company 45)

### DEFERRED (out of this sprint, tracked as P2)
- `/settings/trcloud` health dashboard
- LIFF category GL/SKU editing on mobile
- Streaming bulk progress UI
- Maker/checker flow for `deleteTrcloudAp` >10,000 THB
- Push retry with TRCloud GET check for already-approved APs

---

## 3. Implementation Status

### Already Done (ยืนยันว่าทำงานได้)

| Component | Status | Evidence |
|---|---|---|
| TRCloud API credentials isolated to company 45 | ✅ LIVE | `TRCLOUD_JPS_*` env vars in Vercel; `trcloud-push.ts` uses `TRCLOUD_JPS_COMPANY_ID` |
| Atomic optimistic lock (concurrent push guard) | ✅ LIVE | `_actions.ts:913` — `updateMany WHERE trcloudDocId IS NULL → "pending"` before HTTP call |
| Push button disabled/loading state | ✅ LIVE | `SendToTrcloudButton.tsx` uses `useTransition` + `disabled={pending}` |
| Inline retry on error | ✅ LIVE | `SendToTrcloudButton.tsx` inline error state with retry trigger |
| Sequential bulk push (intentional, not a bug) | ✅ LIVE | `sendExpensesToTrcloud` loops one-by-one; documented as intentional to avoid TRCloud rate limits |
| Happy-path audit trail | ✅ LIVE | `recordPushResult` writes `LEDGER_EXPENSE_PUSHED_TRCLOUD` to `audit_logs` on success |
| Validation gates (GL missing, branch missing) | ✅ LIVE | `loadPushable` returns `configError` for missing `trcloudAccCode` or `trcloudProject` |
| 3-SKU fixed mapping (JPS-100/101/103) | ✅ LIVE | `resolveFixedSku` in `trcloud-push.ts` |
| `approve_status="wait"` on all APs | ✅ LIVE | hardcoded in AP payload builder |
| `tax_option="in"` (VAT-inclusive) | ✅ LIVE | hardcoded in AP payload builder |
| CategoryManager edit-form with GL+SKU fields | ✅ LIVE | edit path includes `trcloudProductCode` + `vatClaimable` |
| TRCloudBranchConfig on web settings | ✅ LIVE | `/ledger/settings` tab |
| companyId filter in `loadPushable` | ✅ LIVE | fixed in previous sprint (AUDIT_ledger-trcloud_2026-06-06.md P0-2) |

### Pending (สิ่งที่ยังไม่ถูกต้อง — รายละเอียดใน §4–6)

| Item | Severity | Sprint |
|---|---|---|
| `vatClaimable` default=true (inverted) | **P0** | Day-1 |
| CategoryManager add-form missing SKU+VAT | **P0** | Day-1 |
| queries.ts "sent" filter matches "pending" | **P0** | Day-1 |
| No intent audit before TRCloud HTTP call | **P0** | Day-1 |
| `deleteTrcloudAp` no role gate + no audit | **P0** | Day-1 |
| Stale-pending reset must reconcile with TRCloud first | **P0** | Day-1 (design only — must not implement wrong approach) |
| Entertainment VAT: soft warning not hard block | P1 | Day-2 |
| `audit_logs` diff missing 4 required fields | P1 | Day-2 |
| Stale lock detection using `updatedAt` | P1 | Day-2 |
| BA spec: clarify companyId=45 is API credential not DB filter | P1 | Day-2 (docs only) |
| `approve_status="wait"` comms to JP Sync finance team | P1 | Day-2 (ops) |

---

## 4. P0 Bug Fixes Required

> ทุก P0 ต้องแก้และ verify ก่อนอนุญาตให้นักบัญชี JP Sync ใช้งานจริง

---

### P0-1 — VAT Default Inverted (Tax Reporting Error · LIVE)

**Severity:** P0 · ข้อมูลภาษีผิดพลาด · มีผลต่อ ภ.พ.30 ที่ยื่นสรรพากร

**ปัญหา:**
หลักอนุรักษ์นิยมทางบัญชีไทย = ค่าใช้จ่ายใหม่ที่ไม่รู้ว่า VAT ขอคืนได้หรือเปล่า **ต้องสมมติว่าขอคืนไม่ได้** จนกว่านักบัญชีจะยืนยัน
ปัจจุบัน schema และ code ตั้งค่า default เป็น `true` (ขอคืนได้) ซึ่งกลับกัน — ทำให้ทุก category ที่สร้างใหม่โดยไม่ตั้ง `vatClaimable` จะส่ง `tax_report=1` เข้า TRCloud ทั้งที่ยังไม่ได้ verify

**Locations:**
1. `prisma/schema.prisma` — `ledger_category` model:
   ```prisma
   vatClaimable  Boolean  @default(true)   // ← ผิด
   ```
2. `app/(admin)/ledger/_actions.ts` line ~816:
   ```typescript
   const inputVatClaimable = category.vatClaimable ?? true   // ← ผิด
   ```

**Fix:**

SQL migration (1 line):
```sql
ALTER TABLE ledger_category ALTER COLUMN vat_claimable SET DEFAULT false;
```

Schema change:
```prisma
vatClaimable  Boolean  @default(false)   // ✅ อนุรักษ์นิยม
```

Code change (`_actions.ts:816`):
```typescript
// Before:
const inputVatClaimable = category.vatClaimable ?? true

// After:
const inputVatClaimable = category.vatClaimable ?? false
```

**Migration required:** YES — `20260607_ledger_vat_claimable_default_false.sql`

**Risk:** แถวที่มีอยู่แล้ว (existing rows) ที่มี `vat_claimable = true` โดยไม่ได้ตั้งใจ (เกิดจาก default เก่า) จะยังส่งผิดอยู่ จนกว่านักบัญชีจะ review และแก้ เพราะฉะนั้นต้องถาม CEO/นักบัญชีว่ามี category ไหนบ้างที่ `vat_claimable = true` ปัจจุบัน (ดู CEO Question #2)

**Error message สำหรับ user:** ไม่ต้องแสดง error — เป็นการเปลี่ยน default behavior เงียบๆ ที่ถูกต้อง

---

### P0-2 — CategoryManager Add-Form Missing SKU + vatClaimable

**Severity:** P0 · ทุก category ที่สร้างใหม่ผ่าน add-form = push ไม่ได้

**ปัญหา:**
`createCategory` action (`_actions.ts` line ~407) และ `categorySchema` (Zod) ไม่มี fields `trcloudProductCode` หรือ `vatClaimable` แต่ edit-form (update path) มีทั้งสองตัว นั่นหมายความว่า:
1. แอดมินกด "เพิ่มหมวด" → กรอก GL code → บันทึก
2. `trcloudProductCode = null`, `vatClaimable = false` (default หลังแก้ P0-1)
3. พนักงานบันทึกค่าใช้จ่ายในหมวดนั้น → `loadPushable` detect `trcloudProductCode IS NULL` → return `configError: "หมวดยังไม่มี SKU"`
4. ปุ่ม push ไม่ขึ้น → push ไม่ได้ ไม่มี error ชัดเจน

**Files affected:**
- `components/features/ledger/CategoryManager.tsx` — add-form section
- `app/(admin)/ledger/_actions.ts` — `categorySchema` Zod + `createCategory` action

**Fix (estimated ~39 LOC total):**

In `CategoryManager.tsx` — add-form JSX, add two fields after GL code input:
```tsx
{/* SKU TRCloud */}
<FormField name="trcloudProductCode" render={({ field }) => (
  <FormItem>
    <FormLabel>SKU TRCloud</FormLabel>
    <Select onValueChange={field.onChange} defaultValue={field.value}>
      <SelectTrigger><SelectValue placeholder="เลือก SKU" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="JPS-100">JPS-100 (สินค้าทั่วไป)</SelectItem>
        <SelectItem value="JPS-101">JPS-101 (บริการ)</SelectItem>
        <SelectItem value="JPS-103">JPS-103 (วัสดุก่อสร้าง)</SelectItem>
      </SelectContent>
    </Select>
    <FormMessage />
  </FormItem>
)} />

{/* VAT Claimable */}
<FormField name="vatClaimable" render={({ field }) => (
  <FormItem className="flex items-center gap-2">
    <Switch checked={field.value} onCheckedChange={field.onChange} />
    <FormLabel>VAT ขอคืนได้</FormLabel>
  </FormItem>
)} />
```

In `_actions.ts` — extend `categorySchema`:
```typescript
// เพิ่มใน categorySchema
trcloudProductCode: z.enum(['JPS-100', 'JPS-101', 'JPS-103']).optional(),
vatClaimable: z.boolean().default(false),
```

In `_actions.ts` — extend `createCategory` Prisma call:
```typescript
data: {
  ...existingFields,
  trcloudProductCode: parsed.trcloudProductCode ?? null,
  vatClaimable: parsed.vatClaimable ?? false,
}
```

**Migration required:** NO — columns already exist from previous migration

---

### P0-3 — `queries.ts` "sent" Filter Matches "pending" Sentinel

**Severity:** P0 · ข้อมูลแสดงผิด · นักบัญชีเห็นว่าส่งแล้วทั้งที่ยัง in-flight

**ปัญหา:**
ใน `queries.ts` filter สำหรับ tab "ส่งแล้ว":
```typescript
// Current (WRONG):
trcloudDocId: { not: null }
```
`"pending"` คือ sentinel string ที่ใส่ระหว่าง atomic lock (ก่อน HTTP call) → ค่า `"pending"` ≠ `null` → แถวที่กำลัง push อยู่จะถูก match เข้า filter "ส่งแล้ว" ทำให้นักบัญชีที่เปิดหน้าอื่นเห็น row นั้นว่า "ส่งแล้ว" ทั้งที่ยังไม่เสร็จ (หรือกำลัง error)

**File:** `app/(admin)/ledger/queries.ts` — `getPushableExpenses` or equivalent filter function

**Fix (~5 LOC):**
```typescript
// Before:
trcloudDocId: { not: null }

// After:
trcloudDocId: { notIn: [null, 'pending'] }
```

**Note:** Prisma `notIn` with null — ต้องตรวจสอบ Prisma version ว่า `notIn: [null, 'pending']` ทำงานถูกต้อง บางเวอร์ชัน `null` ใน array ต้องใช้:
```typescript
AND: [
  { trcloudDocId: { not: null } },
  { trcloudDocId: { not: 'pending' } },
]
```

**Migration required:** NO

---

### P0-4 — No Intent Audit Before TRCloud HTTP Call

**Severity:** P0 · ความเสี่ยง TRCloud AP orphan (สร้างแล้วแต่ LedgerLine ไม่รู้)

**ปัญหา:**
Sequence ปัจจุบัน:
```
1. set trcloudDocId = "pending"    ← atomic lock ✅
2. POST ap/create.php → TRCloud    ← HTTP call (อาจ crash)
3. recordPushResult(docId, docNo)   ← write audit_logs
```
ถ้า Vercel function timeout/crash ระหว่าง step 2 → 3:
- TRCloud มี AP สร้างแล้ว (มี docId จริง)
- `audit_logs` ไม่มี record ใดๆ ของการ push นี้
- `trcloudDocId` ยังเป็น `"pending"` (stale lock)
- นักบัญชีไม่รู้ว่ามี AP ซ้อนอยู่ใน TRCloud หรือเปล่า

**Fix (~10 LOC) ใน `trcloud-push.ts`:**

เพิ่ม intent audit BEFORE HTTP call:
```typescript
// Step 1.5: Write intent BEFORE calling TRCloud
await supabase.from('audit_logs').insert({
  org_id: orgId,
  actor_id: actorId,
  action: 'LEDGER_EXPENSE_PUSH_STARTED',
  resource_type: 'ledger_expense',
  resource_id: expenseId,
  diff: {
    expenseDocCode,
    actorRole,
    startedAt: new Date().toISOString(),
  },
})

// Step 2: NOW call TRCloud
const result = await postToTrcloud(payload)

// Step 3: recordPushResult (existing)
await recordPushResult(expenseId, result.docId, result.docNo)
```

**Runbook for orphan recovery:**
ถ้าเจอ `trcloudDocId = "pending"` นานกว่า 10 นาที (stale lock):
1. Query `audit_logs WHERE action='LEDGER_EXPENSE_PUSH_STARTED' AND resource_id=expenseId`
2. ถ้าเจอ intent record → call `GET ap/list.php?reference=expenseDocCode` ใน TRCloud
3. ถ้า TRCloud มี AP อยู่แล้ว → stamp docId ที่ถูกต้อง (ไม่ allow retry)
4. ถ้า TRCloud ไม่มี AP → clear `"pending"` เป็น `null` → allow retry

**Migration required:** NO (`audit_logs` table exists)

---

### P0-5 — `deleteTrcloudAp` No Role Gate, No Audit

**Severity:** P0 · Security — ลบ AP ใน TRCloud โดยไม่มี authorization

**ปัญหา:**
ฟังก์ชัน `deleteTrcloudAp` (ใน `_actions.ts` หรือ `trcloud-push.ts`) ถูก export โดยไม่มี:
1. Session check — ใครก็ได้ที่รู้ `docId` เรียกได้
2. Role verification — ต้องการ `accountant` หรือ `super_admin` เท่านั้น
3. Audit trail — ไม่มี log การลบ

**Fix (~20 LOC):**
```typescript
export async function deleteTrcloudAp(docId: string) {
  // 1. Verify session
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  // 2. Verify role
  const actor = await resolveLedgerActor(session.user.id)
  if (!['accountant', 'super_admin'].includes(actor.role)) {
    throw new Error('สิทธิ์ไม่เพียงพอ — ต้องการสิทธิ์นักบัญชีหรือ super_admin')
  }

  // 3. Write audit BEFORE delete
  await supabase.from('audit_logs').insert({
    org_id: actor.orgId,
    actor_id: actor.id,
    action: 'LEDGER_EXPENSE_TRCLOUD_AP_DELETED',
    resource_type: 'trcloud_ap',
    resource_id: docId,
    diff: { docId, deletedBy: actor.id, deletedAt: new Date().toISOString() },
  })

  // 4. Call TRCloud delete endpoint
  return await callTrcloudDelete(docId)
}
```

**Migration required:** NO

---

### P0-6 — Stale "pending" Reset Must Query TRCloud First (Design Constraint)

**Severity:** P0 · Design guard — ถ้า implement ผิดจะสร้าง duplicate AP

**ปัญหา:**
ไม่มี stale-lock reset logic ในระบบปัจจุบัน (สิ่งนี้ถูกต้อง — ยังไม่ควรมี) เมื่อ implement EC-10 (stale pending auto-reset) ต้องไม่ใช้ approach นี้:
```typescript
// ❌ WRONG — ลบ pending เลยโดยไม่เช็ค TRCloud
if (expense.trcloudDocId === 'pending' && isStale(expense.updatedAt)) {
  await updateExpense(id, { trcloudDocId: null })  // อาจสร้าง AP ซ้ำ
}
```

**Correct approach:**
```typescript
// ✅ CORRECT — ตรวจ TRCloud ก่อนเสมอ
if (expense.trcloudDocId === 'pending' && isStale(expense.updatedAt)) {
  const existing = await getTrcloudAp(expense.docCode)  // GET ap/list.php?reference=
  if (existing.found) {
    // AP มีอยู่แล้วใน TRCloud — stamp docId จริง
    await updateExpense(id, { trcloudDocId: existing.docId, trcloudDocNo: existing.docNo })
  } else {
    // ไม่มี AP → safe to retry
    await updateExpense(id, { trcloudDocId: null })
  }
}
```

**Migration required:** NO — design guide only; implement when building EC-10

**Staleness threshold:** `updatedAt < NOW() - INTERVAL '10 minutes'` (ใช้ `updatedAt` ที่มีอยู่แล้ว ไม่ต้องเพิ่ม column)

---

## 5. P1 Items (Before Accountant-Facing Rollout)

> ควรทำใน sprint เดียวกันหรือ sprint ถัดไปก่อน go-live กับนักบัญชี JP Sync

---

### P1-1 — Entertainment VAT: Soft Warning Not Hard Block

**บริบท:** ค่าเลี้ยงรับรอง (ค่ารับรอง, GL 5901200) — VAT ขอคืนได้แบบมีเงื่อนไข ตาม ม.65 ทวิ (5):
- ถ้ามีใบกำกับภาษีถูกต้อง + จำนวนไม่เกิน 2 เท่าอัตราปกติ → ขอคืน VAT ได้
- ถ้าไม่มีใบกำกับหรือเกินเพดาน → ขอคืนไม่ได้

**ปัญหาเดิม:** ระบบบล็อก hard ด้วย `vatClaimable=false` สำหรับหมวดนี้ ทำให้นักบัญชีที่มีใบกำกับครบไม่สามารถเลือก "ขอคืน VAT ได้"

**Fix:** เปลี่ยนเป็น soft warning — แสดง tooltip/banner เตือน แต่ไม่บังคับ:
```
⚠️ ค่ารับรอง — VAT ขอคืนได้เฉพาะกรณีมีใบกำกับภาษีครบถ้วน
   และไม่เกินเพดานตาม ม.65 ทวิ (5) · ยืนยันว่าครบเงื่อนไข?
   [✓ ยืนยัน] [✗ ไม่ขอคืน]
```

**Files:** `CategoryManager.tsx` — add conditional warning near `vatClaimable` toggle when `glCode === '5901200'`

---

### P1-2 — `audit_logs` Diff Must Include 4 Required Fields

**บริบท:** `LEDGER_EXPENSE_PUSHED_TRCLOUD` log entry ปัจจุบันมีเพียง `trcloudDocId`, `trcloudDocNo` แต่สำหรับ Revenue Dept audit trail ต้องมีครบ:

| Field | เหตุผล |
|---|---|
| `amount` | ยืนยันยอดที่ส่ง |
| `vendorTaxId` | ยืนยันเจ้าหนี้ที่ถูกต้อง |
| `taxPeriod` (YYYY-MM) | ติดตาม period ที่อยู่ใน ภ.พ.30 |
| `docCode` | link back to LedgerLine expense |

**Fix (~8 LOC) ใน `trcloud-push.ts` → `recordPushResult`:
```typescript
diff: {
  trcloudDocId: docId,
  trcloudDocNo: docNo,
  // เพิ่ม 4 fields นี้:
  amount: expense.totalAmount,
  vendorTaxId: expense.vendor?.taxId ?? null,
  taxPeriod: `${expense.expenseDate.getFullYear()}-${String(expense.expenseDate.getMonth() + 1).padStart(2, '0')}`,
  docCode: expense.docCode,
}
```

---

### P1-3 — Stale Lock Detection Using `updatedAt`

**บริบท:** เมื่อ implement EC-10 stale detection (ดู P0-6 approach)

**Spec:** ใช้ `updatedAt < NOW() - INTERVAL '10 minutes'` บน Postgres:
```sql
SELECT id, doc_code, updated_at
FROM ledger_expense
WHERE trcloud_doc_id = 'pending'
  AND updated_at < NOW() - INTERVAL '10 minutes'
```

**ข้อดี:** ไม่ต้องเพิ่ม column ใหม่ — `updatedAt` ถูก set ทุกครั้งที่ `updateMany` รวมถึงตอน set `"pending"`

---

### P1-4 — BA Spec Clarification: companyId=45 Is TRCloud API Credential, NOT DB Filter

**บริบท:** ในเอกสารหลายชิ้นเขียนว่า "companyId=45" ซึ่งทำให้นักพัฒนาในอนาคตอาจเพิ่ม `WHERE companyId = '45'` ใน Postgres query โดยผิดพลาด

**Clarification (ต้องเพิ่มใน comments และ `LEDGERLINE_TRCLOUD_REFERENCE.md`):**

```
TRCLOUD_JPS_COMPANY_ID=45
  → TRCloud API credential ONLY
  → Routes to "JPS GROUP" tenant on TRCloud's side
  → NOT a Postgres column
  → Postgres isolation = actor.companyId (UUID) via loadPushable(orgId, id, actor.companyId)
  → ห้าม WHERE company_id = '45' ใน Postgres query
```

---

### P1-5 — Operational Procedure: `approve_status="wait"` Comms

**บริบท:** ทุก AP ที่ LedgerLine push เข้า TRCloud จะมี status "รออนุมัติ" (draft) อัตโนมัติ — นักบัญชีต้อง approve ใน TRCloud แยกต่างหากก่อน AP จะ post เข้าบัญชี

**Action required:** แจ้ง JP Sync finance team ก่อน go-live:
1. เมื่อ LedgerLine ส่ง AP สำเร็จ → เข้า TRCloud → ไปที่ AP list → filter "รออนุมัติ" → approve ทีละรายการหรือ bulk approve
2. AP ที่ยังไม่ approve ≠ โพสต์เข้าบัญชี → ยอดในงบดุล/กำไรขาดทุนจะไม่สมบูรณ์จนกว่าจะ approve
3. Recommend: นักบัญชีตั้ง routine daily approve ใน TRCloud ทุกเย็น

**แสดงใน UI:** เพิ่ม info banner ใน `SendToTrcloudButton` หลัง push สำเร็จ:
```
✅ ส่ง TRCloud แล้ว · เลขที่ [DOC_NO]
ℹ️ AP อยู่ในสถานะ "รออนุมัติ" — นักบัญชีต้อง approve ใน TRCloud ก่อน post เข้าบัญชี
```

---

## 6. P2 Items (Post-Pilot)

| # | Item | Rationale | Effort |
|---|---|---|---|
| P2-1 | Settings Hub completion indicators (X/Y categories configured, X/Y branches configured) | ช่วย admin รู้ว่าต้องตั้งค่าอีกเท่าไหร่ก่อน go-live | ~20 LOC UI |
| P2-2 | Push retry with TRCloud GET check for already-approved APs | กัน double-push ถ้า AP ถูก approve แล้ว | ~15 LOC + TRCloud GET call |
| P2-3 | Maker/checker for `deleteTrcloudAp` amounts >10,000 THB | Internal control สำหรับยอดสูง | ~30 LOC + UI |
| P2-4 | `/settings/trcloud` health dashboard | CEO/IA recommendation — aggregate push status, error rate | ~1 day |
| P2-5 | LIFF category GL/SKU editing on mobile | Pending CEO answer on Question #3 (mobile vs desktop) | ~40 LOC |
| P2-6 | Streaming bulk progress (real-time) | Pre-flight message ~6 LOC เพียงพอสำหรับ MVP ตอนนี้ | ~1 day (WebSocket/SSE) |

---

## 7. Acceptance Criteria (Pilot Launch Gate)

> ทุกข้อ P0 ต้องผ่านก่อน allow นักบัญชีใช้งาน production

### Gate 1 — Tax Correctness
- [ ] G1.1 สร้าง category ใหม่โดยไม่เลือก `vatClaimable` → default = `false` → ตรวจใน DB: `SELECT vat_claimable FROM ledger_category WHERE name = '<ชื่อ>'` → ต้องได้ `false`
- [ ] G1.2 Push expense ที่ category มี `vatClaimable=false` → ดู AP ใน TRCloud → `tax_report` field = `"0"`
- [ ] G1.3 Push expense ที่ category มี `vatClaimable=true` → ดู AP ใน TRCloud → `tax_report` field = `"1"`

### Gate 2 — CategoryManager Add-Form
- [ ] G2.1 เปิด `/ledger/settings` → เพิ่มหมวดใหม่ → ฟอร์มมี dropdown "SKU TRCloud" (JPS-100/101/103) และ toggle "VAT ขอคืนได้"
- [ ] G2.2 กรอกครบ → บันทึก → ตรวจ DB: `SELECT trcloud_product_code, vat_claimable FROM ledger_category WHERE name = '<ชื่อ>'` → ไม่ใช่ null
- [ ] G2.3 บันทึกค่าใช้จ่ายในหมวดที่เพิ่งสร้าง → กด push → สำเร็จ (ไม่ error "หมวดยังไม่มี SKU")

### Gate 3 — Filter Correctness
- [ ] G3.1 เปิด push ใน browser tab A → เปิด tab B ดู filter "ส่งแล้ว" ระหว่างที่ tab A กำลัง push → tab B ต้องไม่แสดง row นั้น (ยังไม่สำเร็จ)
- [ ] G3.2 หลัง push สำเร็จ → tab B refresh → row ต้องปรากฏใน "ส่งแล้ว"

### Gate 4 — Audit Trail Completeness
- [ ] G4.1 Push expense → ดู `audit_logs WHERE action='LEDGER_EXPENSE_PUSH_STARTED'` → ต้องมี record ก่อน AP created
- [ ] G4.2 Push สำเร็จ → ดู `audit_logs WHERE action='LEDGER_EXPENSE_PUSHED_TRCLOUD'` → diff ต้องมี: `amount`, `vendorTaxId`, `taxPeriod`, `docCode`

### Gate 5 — deleteTrcloudAp Security
- [ ] G5.1 Call `deleteTrcloudAp` as `user` role → ได้รับ error "สิทธิ์ไม่เพียงพอ"
- [ ] G5.2 Call `deleteTrcloudAp` as `accountant` role → สำเร็จ → `audit_logs` มี `LEDGER_EXPENSE_TRCLOUD_AP_DELETED`

### Gate 6 — End-to-End Happy Path
- [ ] G6.1 สร้างค่าใช้จ่ายทดสอบ → assign category ที่มี GL+SKU → confirm → push → ดู TRCloud AP: company=JPS GROUP, SKU=JPS-100/101/103, GL ถูก, department ถูก, status=รออนุมัติ → approve → post
- [ ] G6.2 กด push ซ้ำในใบเดิม → ระบบ return "ส่งแล้ว" ไม่สร้าง AP ซ้ำ

---

## 8. Persona Sign-off Table

| Persona | Concern | Verdict | Condition |
|---|---|---|---|
| **PM** | Timeline + scope creep | ✅ Approve | P0 only Day-1; P1 Day-2; strict scope lock |
| **BA** | P1-4 companyId spec ambiguity | ✅ Approve | Add inline comment to `trcloud-push.ts` clarifying credential vs DB filter |
| **System Analyst** | Intent audit gap (P0-4) | ✅ Approve | Must implement before any production push |
| **Architect** | `deleteTrcloudAp` unguarded export (P0-5) | ✅ Approve | Wrap in server action with role gate before exposing any UI |
| **Senior Dev** | Stale-pending recovery design (P0-6) | ✅ Approve | TRCloud-reconcile-first approach locked; wrong approach explicitly documented as anti-pattern |
| **FE** | CategoryManager add-form (P0-2) | ✅ Approve | Add fields match edit-form parity; use existing Select/Switch components from shadcn |
| **BE** | queries.ts "pending" leak (P0-3) | ✅ Approve | `notIn: [null, 'pending']` pattern; verify Prisma null-in-array behavior |
| **UX** | `approve_status="wait"` not communicated (P1-5) | ✅ Approve | Add success banner explaining TRCloud approval step |
| **UI** | No visual diff between "pending" and "sent" | ✅ Approve | Filter fix (P0-3) resolves visual confusion; P2 health dashboard for full visibility |
| **QA** | Gate 3 concurrent push test | ✅ Approve | G3.1/G3.2 in acceptance criteria above |
| **QC** | audit_logs diff incomplete (P1-2) | ✅ Approve | 4 required fields added; Revenue Dept audit trail complete |
| **DevOps** | Migration deployment order | ✅ Approve | SQL migration before code deploy; verify on staging first |
| **Owner (CEO)** | 4 open questions (§10) | ⏳ Pending | Answers needed before pilot launch |
| **FIN (CPA/CFO)** | VAT default inverted (P0-1) | ✅ Approve | Conservative default=false is correct per Thai accounting standard; existing rows must be reviewed by accountant |
| **AUD (Internal Audit)** | P0-5 + P0-4 auth/audit gaps | ✅ Approve | Both gaps closed in P0 sprint before any accountant use |

---

## 9. Locked Decisions

| Decision | ผู้ตัดสิน | วันที่ | รายละเอียด |
|---|---|---|---|
| **D-LL-01** — Use 3 fixed SKUs (JPS-100/101/103), no dynamic SKU creation | CEO + นักบัญชี JP Sync | 2026-06-06 | แก้ปัญหา SKU explosion ใน v1; SKU expansion ต้องผ่านนักบัญชีอนุมัติ |
| **D-LL-02** — TRCloud company 45 (JPS GROUP) isolated from shared company 31 | CEO | 2026-06-06 | `TRCLOUD_JPS_*` env vars; ห้ามใช้ company 31 สำหรับ LedgerLine push |
| **D-LL-03** — `approve_status="wait"` on all pushed APs (maker/checker) | นักบัญชี JP Sync | 2026-06-06 | Intentional — นักบัญชีต้อง review ก่อน post; ไม่ auto-approve |
| **D-LL-04** — `tax_option="in"` (VAT inclusive) for all AP lines | นักบัญชี JP Sync | 2026-06-06 | ตามมาตรฐาน TRCloud JPS; VAT ถูก extract proportionally per line |
| **D-LL-05** — Sequential bulk push (no parallel) | Architect | 2026-06-06 | หลีกเลี่ยง TRCloud rate limit; pre-flight message เพียงพอสำหรับ UX |
| **D-LL-06** — `vatClaimable` default=false (conservative Thai accounting) | FIN+AUD | 2026-06-07 | ห้ามเปลี่ยนกลับ default=true โดยไม่ปรึกษานักบัญชี |
| **D-LL-07** — Stale pending recovery must reconcile with TRCloud first | Architect + AUD | 2026-06-07 | ห้าม clear "pending" เป็น null โดยไม่ตรวจ `GET ap/list.php?reference=` ก่อน |
| **D-LL-08** — `deleteTrcloudAp` requires accountant or super_admin role | AUD | 2026-06-07 | Internal control; audit trail required on every delete |
| **D-LL-09** — Intent audit entry before TRCloud HTTP call | AUD | 2026-06-07 | `LEDGER_EXPENSE_PUSH_STARTED` written to `audit_logs` before POST |
| **D-LL-10** — `TRCLOUD_JPS_COMPANY_ID=45` is API credential not DB filter | BA + Architect | 2026-06-07 | DB isolation = UUID via `actor.companyId`; ห้าม `WHERE company_id = '45'` ใน Postgres |

---

## 10. CEO Questions (4 Open Items — ต้องตอบก่อน Pilot Launch)

> หยุดรอคำตอบจาก CEO/นักบัญชี JP Sync ก่อนให้ใครใช้งานจริง

### Q1 — TRCloud Approval Workflow (Operational)
**คำถาม:** นักบัญชี JP Sync ยอมรับ workflow ที่ว่า หลังจาก LedgerLine push สำเร็จ จะต้องเข้าไป approve ใน TRCloud อีกครั้ง (AP สถานะ "รออนุมัติ") ก่อน AP จะ post เข้าบัญชีจริงได้ใช่ไหม?

**ทำไมต้องถาม:** ถ้านักบัญชีไม่รู้ขั้นตอนนี้ → AP อาจค้างใน TRCloud หลายสัปดาห์โดยไม่ถูก approve → งบดุลไม่ตรง

**ตัวเลือก:**
- A) ยอมรับ → แค่ training + info banner ในระบบ
- B) ต้องการ auto-approve → ต้องแก้ไข `approve_status` เป็น `"approved"` (requires TRCloud API permission change; มีความเสี่ยงสูง)

---

### Q2 — VAT Claimable Existing Data Assessment
**คำถาม:** รัน query นี้บน prod DB แล้วส่งผลลัพธ์ให้ผม — จะรู้ว่า category ไหนอยู่ในสถานะ "ผิดพลาด" จาก default=true เก่า:

```sql
SELECT name, vat_claimable, trcloud_product_code, trcloud_acc_code
FROM ledger_category
WHERE org_id = '<JPS_ORG_ID>'
ORDER BY vat_claimable DESC, name;
```

**ทำไมต้องถาม:** Migration จะเปลี่ยนแค่ `DEFAULT` value — แถวที่มีอยู่แล้วจะ retain ค่าเดิม ถ้ามีหมวดที่ตั้ง `vat_claimable=true` เพราะ default เก่า (ไม่ใช่เจตนา) → นักบัญชีต้องไปแก้เอง

---

### Q3 — Accountant Works Mobile or Desktop?
**คำถาม:** นักบัญชี JP Sync ที่จะใช้ push expense ทำงานบน **โทรศัพท์มือถือ** หรือ **คอมพิวเตอร์** เป็นหลัก?

**ทำไมต้องถาม:** กำหนด priority ของ P2-5 (LIFF category GL/SKU editing):
- ถ้า desktop หลัก → P2-5 = post-pilot, ไม่เร่ง
- ถ้า mobile หลัก → P2-5 ยกระดับเป็น P1 (ต้องทำก่อน go-live)

---

### Q4 — Pilot Timeline Preference
**คำถาม:** ต้องการ pilot แบบไหน?

| ตัวเลือก | ระยะเวลา | สิ่งที่ได้ | ความเสี่ยง |
|---|---|---|---|
| **A) Fast MVP** | ~1 วัน | P0 fixes only (6 bugs · ~80 LOC) | มี P1 gaps แต่ใช้งานได้ปลอดภัย |
| **B) Full Sprint** | ~5-7 วัน | P0 + P1 + UX polish | ล่าช้ากว่า แต่นักบัญชีใช้งานได้ราบรื่นกว่า |

**แนะนำ:** ตัวเลือก A → deploy P0 ก่อน → ทดสอบกับนักบัญชี JP Sync 1 คน → เก็บ feedback → sprint P1 ทันที

---

## 11. Pilot Plan (Day-1 Hotfix Budget)

### Sprint: P0 Fix Sprint
**Target:** ~80 LOC + 1 SQL migration line · ควรเสร็จใน 2-4 ชั่วโมง

```
Branch: tax-invoice (existing) หรือ hotfix/ledger-trcloud-p0 (ถ้าแยก)
Deploy target: setup → prod (auto-deploy)
```

### Execution Order (สำคัญ — ทำตามลำดับ)

```
Step 1: Write + apply migration
  File: db/migrations/20260607_ledger_vat_claimable_default_false.sql
  SQL:  ALTER TABLE ledger_category ALTER COLUMN vat_claimable SET DEFAULT false;
  Apply: psql prod (verify column default changed before code deploy)

Step 2: schema.prisma change
  ledger_category.vatClaimable: @default(true) → @default(false)

Step 3: _actions.ts:816
  ?? true → ?? false

Step 4: CategoryManager.tsx add-form
  Add trcloudProductCode Select + vatClaimable Switch
  (match edit-form component pattern)

Step 5: categorySchema Zod + createCategory action
  Add fields to schema + Prisma insert

Step 6: queries.ts filter
  { not: null } → { notIn: [null, 'pending'] }

Step 7: trcloud-push.ts intent audit
  Insert LEDGER_EXPENSE_PUSH_STARTED before POST ap/create.php

Step 8: deleteTrcloudAp role gate + audit
  Wrap with session + role check + audit insert

Step 9: Verify all 6 Gate conditions (§7)
```

### Pre-Deploy Checklist
- [ ] psql prod: confirm `vat_claimable` default changed to `false`
- [ ] psql prod: no rows with `trcloud_doc_id = 'pending'` older than 10 min (clean slate)
- [ ] Vercel env: `TRCLOUD_JPS_COMPANY_ID`, `TRCLOUD_JPS_ENCRYPT_HEAD`, `TRCLOUD_JPS_API_URL` present
- [ ] Test category create in staging → verify `trcloudProductCode` and `vatClaimable` saved
- [ ] Test push single expense → check `audit_logs` for `PUSH_STARTED` + `PUSHED_TRCLOUD` entries
- [ ] Notify JP Sync accountant: AP ใหม่จะ appear ใน TRCloud status "รออนุมัติ" → ต้อง approve ใน TRCloud

### Post-Deploy Monitoring (30 min after deploy)
```sql
-- ตรวจ pending ค้าง
SELECT id, doc_code, trcloud_doc_id, updated_at
FROM ledger_expense
WHERE trcloud_doc_id = 'pending'
ORDER BY updated_at;

-- ตรวจ audit trail ครบ
SELECT action, COUNT(*) as cnt
FROM audit_logs
WHERE action LIKE 'LEDGER_EXPENSE%'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY action;

-- ตรวจ default ใหม่ทำงาน
SELECT vat_claimable, COUNT(*) 
FROM ledger_category
GROUP BY vat_claimable;
```

---

## Appendix A — File Index

| File | Role | P0 Changes |
|---|---|---|
| `lib/ledger/trcloud-push.ts` | TRCloud API client + AP builder | P0-4 (intent audit), P0-6 (stale design) |
| `app/(admin)/ledger/_actions.ts` | Server actions (push, create, delete) | P0-1 (line ~816), P0-2 (line ~407 createCategory), P0-5 (deleteTrcloudAp) |
| `app/(admin)/ledger/queries.ts` | DB query helpers | P0-3 (sent filter) |
| `components/features/ledger/CategoryManager.tsx` | Category CRUD UI | P0-2 (add-form fields) |
| `components/features/ledger/SendToTrcloudButton.tsx` | Push button + loading/error | P1-5 (success banner) |
| `prisma/schema.prisma` | DB schema | P0-1 (vatClaimable default) |
| `db/migrations/20260607_*.sql` | Migration | P0-1 (1 line SQL) |

## Appendix B — TRCloud AP Payload Reference

```json
{
  "company_id": "45",
  "doc_date": "YYYY-MM-DD",
  "approve_status": "wait",
  "tax_option": "in",
  "contact_id": "<resolved from vendor taxId>",
  "project": "<trcloudProject from branch config>",
  "dept": "<trcloudDept from branch config>",
  "lines": [
    {
      "product_id": "<JPS-100 | JPS-101 | JPS-103>",
      "product_name": "<expense description>",
      "qty": 1,
      "price": "<amount ex-VAT>",
      "acc_code": "<trcloudAccCode from category>",
      "tax_report": "<1 if vatClaimable else 0>"
    }
  ]
}
```

---

*Audit closed: 2026-06-07 · ทุก persona sign-off รวบรวมแล้ว · รอ CEO answers (§10) ก่อน pilot launch*
