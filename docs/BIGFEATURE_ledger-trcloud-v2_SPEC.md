# LedgerLine TRCloud AP Integration v2 — Feature Specification

**Project:** Pool ERP — LedgerLine Module  
**Feature:** LedgerLine → TRCloud AP Integration v2  
**Status:** 90% Complete (Implementation Ready)  
**Deadline:** เร่งด่วน (Deployed)  
**Spec Date:** 2026-06-07  

---

## 1. Executive Summary & Business Goal

### Business Objective
ส่งรายการค่าใช้จ่ายที่ confirm แล้วจาก LedgerLine เข้า TRCloud เป็น AP ใบกำกับภาษีซื้ออัตโนมัติ สำหรับ JP Sync company 45

**ความสำคัญ:** นักบัญชีสามารถบันทึกค่าใช้จ่ายใน LedgerLine แล้วส่งไปยัง TRCloud โดยอัตโนมัติ ไม่ต้องพิมพ์ใหม่ในระบบบัญชี และลดข้อผิดพลาด SKU explosion

### Success Metrics (KPIs)
1. **Speed:** ค่าใช้จ่าย confirm → AP สร้างใน TRCloud ภายใน 30 วินาที
2. **Data Quality:** 0 SKU explosions (จำนวน SKU ส่งต่อต้องตรงกับ TRCloud product master)
3. **Manual Effort:** นักบัญชีไม่ต้องพิมพ์ใหม่ (dual entry eliminated)
4. **Rollout:** JPS company 45 only (ไม่ส่งผ่านไปยัง shared company 31)

---

## 2. Users & Personas

### Primary Users
| Role | Organization | Key Action | Frequency |
|------|--------------|-----------|-----------|
| **CEO / Owner** | JP Sync | Configure credentials, monitor API health, approve rollback | Ad-hoc |
| **Org Admin / Accounting Manager** | JP Sync (org-level) | Manage category GL codes + SKU mappings, audit sync status | Daily |
| **Accounting Staff** | JP Sync (org-level) | Confirm expenses in LedgerLine, view TRCloud sync status | 5–20x/day |
| **Branch Manager** | Each branch (สาขา) | Set up TRCloud project + department per branch | At setup |

### User Permissions (Role-Based)
- **super_admin:** Full access (create/edit/delete categories, branches, credentials)
- **org_admin:** Edit categories + branch config for their organization
- **admin:** Edit categories + branch config (org-scoped)
- **accountant:** View categories, confirm expenses, see sync status
- **user:** Read-only (view expense list, TRCloud status)

---

## 3. Feature Overview

### What is v2?
**v1** (old): Proof-of-concept push using hardcoded SKU `JPS-100`, GL code from comments, no branch-per-department logic.  
**v2** (new): Production-ready with:
- Per-category GL code + SKU mapping (admin-configurable)
- Per-branch TRCloud project + department assignment
- 3 fixed SKUs: `JPS-100` (ordinary expense), `JPS-101` (vat-claimable), `JPS-103` (no-vat)
- Validation gates before push (missing GL/SKU → clear error)
- VAT claim control per category

### Core Workflow
```
Accountant creates expense (LedgerLine)
  ↓
[Category assigned with GL code + SKU + VAT setting]
  ↓
Accountant confirms expense
  ↓
System validates: GL ✓, SKU ✓, branch TRCloud config ✓
  ↓
"ส่ง TRCloud" button appears (visible if all validations pass)
  ↓
[Click → pushExpenseToTrcloud()]
  ↓
TRCloud AP created (JPS_AP format) within 30s
  ↓
docNo returned + displayed in UI
  ↓
Status = "synced" ✓
```

---

## 4. Technical Architecture

### 4.1 Database Schema Changes

#### New Columns on `ledger_category`
```sql
ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_acc_code VARCHAR(7);
ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_product_code VARCHAR(20);
ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS vat_claimable BOOLEAN NOT NULL DEFAULT TRUE;
```

**Constraints:**
- `trcloud_acc_code`: 7-digit GL code, validated in CategoryManager UI (pattern: `^\d{7}$`)
- `trcloud_product_code`: One of `[JPS-100, JPS-101, JPS-103]` (dropdown, no free text)
- `vat_claimable`: `TRUE` = tax_report=1 in AP, `FALSE` = tax_report=0

#### TRCloud Product Mapping
**Removed:** `ledger_trcloud_product` table (legacy LDG* cache)  
**New approach:** Fixed SKU mapping in code + TRCloud product master lookup on push

| SKU | Use Case | tax_report |
|-----|----------|-----------|
| JPS-100 | Standard expense, VAT claimable | 1 or 0 (per category) |
| JPS-101 | Forced VAT-claimable (e.g., import goods) | 1 |
| JPS-103 | Non-VAT (e.g., wages, penalties) | 0 |

#### Ledger Status Tracking
```sql
-- ledger_entry.trcloud_sync_status
-- Enum: null | "pending" | "synced" | "failed"
-- ledger_entry.trcloud_doc_no
-- Text: TRCloud AP docNo returned from API
-- ledger_entry.trcloud_error_message
-- Text: Error details if sync failed
```

### 4.2 API Integration (TRCloud)

#### Environment Variables (Vercel Production)
```
TRCLOUD_JPS_COMPANY_ID        = "45"
TRCLOUD_JPS_PASSKEY           = "***" (encrypted)
TRCLOUD_JPS_ENCRYPT_HEAD      = "***" (AES IV)
TRCLOUD_API_ENDPOINT          = "https://trcloud.jpsync.co.jp/api/v2"
```

#### Credentials Scope
- **Company ID 45 only** (JP Sync legal entity)
- Shared company 31 (franchisees) NOT included
- Per-branch project + department selector below company level

#### API Endpoint: Create AP (JPS_AP Format)

**POST** `/api/v2/trcloud/ap/create`

**Request Payload:**
```json
{
  "companyId": "45",
  "projectCode": "สาขา-xxx",
  "departmentCode": "นิติบุคคล-yyy",
  "glCode": "1210000",
  "sku": "JPS-100",
  "amount": 5000.00,
  "taxAmount": 500.00,
  "taxReport": 1,
  "description": "ค่าน้ำ - สาขา Bangkok",
  "vendorId": "V001",
  "invoiceNo": "INV-2026-001",
  "invoiceDate": "2026-06-07",
  "dueDate": "2026-07-07"
}
```

**Response (Success):**
```json
{
  "success": true,
  "docNo": "AP-2026-000145",
  "trcloudId": "ap_12345abc",
  "createdAt": "2026-06-07T10:30:45Z"
}
```

**Response (Error):**
```json
{
  "success": false,
  "errorCode": "VALIDATION_FAILED",
  "message": "SKU JPS-100 not found in product master",
  "fieldName": "sku"
}
```

### 4.3 Implementation Files

#### Core Library
**`lib/ledger/trcloud-push.ts`** (v2)
- `pushExpenseToTrcloud(expenseId, branched, categoryData)` → Promise<{docNo, error?}>
- `resolveFixedSku(productCode)` → SKU string or throw error
- `validatePushable(expense, category, branchConfig)` → ValidationResult
- Defensive error messages in Thai
- Logs all API calls + responses

#### Data Loading
**`app/(dashboard)/ledger/_actions.ts`** - `loadPushable()`
- Fetches all "confirmed" expenses with missing GL/SKU
- Filters by company + branch
- Returns: `{expenses[], validationErrors[]}`

**`app/(dashboard)/ledger/_actions.ts`** - `loadExpenseDetail(expenseId)`
- Includes `category.{trcloud_acc_code, trcloud_product_code, vat_claimable}`
- Includes `branch.{trcloud_project, trcloud_department}`

#### UI Components

**Category Manager** (`app/(dashboard)/settings/หมวดค่าใช้จ่าย/[id]`)
- Read-only display: GL code, SKU, VAT checkbox (requires category edit modal)
- Edit modal: 
  - GL Code input (7-digit validator, regex: `^\d{7}$`)
  - SKU dropdown (enum: JPS-100 | JPS-101 | JPS-103)
  - VAT Claimable checkbox
- Save button → `updateCategory()` action
- Success toast: "บันทึกหมวดค่าใช้จ่าย [name] สำเร็จ"
- Error toast: "GL code ต้องเป็นตัวเลข 7 หลัก"

**TRCloud Branch Config** (`app/(dashboard)/settings/สาขา/[branchId]`)
- Settings page under "Settings > สาขา"
- Fields:
  - **TRCloud Project:** Free-text input (e.g., "สาขา-Bangkok-001")
  - **TRCloud Department:** Free-text input (e.g., "นิติบุคคล-JP-Sync-Ltd")
- Visible only if user = org_admin or admin or super_admin
- Save button → `updateBranchTrcloudConfig(branchId, {project, department})` action
- Validation: Both fields required, no special chars
- Success toast: "บันทึก TRCloud config สำเร็จ"

**Expense Action Button** (`app/(dashboard)/ledger/expense-detail`)
- "ส่ง TRCloud" button (emerald, Pool ERP design token)
- Visible only if:
  - Expense status = "confirmed"
  - Category has GL code ✓
  - Category has SKU ✓
  - Branch has trcloud_project + trcloud_department ✓
- Disabled with tooltip if validation fails
- On click: `pushExpenseToTrcloud(expenseId)` → shows progress bar (30s timeout)
- On success: 
  - Toast: "ส่ง TRCloud สำเร็จ AP-2026-000145"
  - Inline: "synced" status + docNo displayed
- On error:
  - Toast: Thai error message from API (e.g., "SKU JPS-100 ไม่พบใน TRCloud")
  - Fallback generic: "ส่ง TRCloud ล้มเหลว กรุณาลอง reload หรือติดต่อ admin"

**Admin Console (LIFF)** (`LIFF admin console`)
- Same TRCloud branch config fields (project + department)
- Optional: Bulk upload GL codes for all categories via CSV
- Progress bar showing "% of categories with GL + SKU"

#### Seed Script
**`scripts/seed-ledger-categories-jps.mjs`**
- Seeds 21 JP Sync company 45 categories with GL codes + SKU assignments
- Runs: `node scripts/seed-ledger-categories-jps.mjs`
- Prerequisite: migration applied (columns exist)
- Categories (sample):
  - ค่าน้ำ-ไฟ (GL: 5101010, SKU: JPS-100)
  - ค่าสูทรกาส (GL: 5101020, SKU: JPS-100)
  - ค่าโทรศัพท์ (GL: 5101030, SKU: JPS-103)
  - ... (full list in script)

#### Error Handling (Defensive)

**Scenario 1: Migration not applied**
- `listCategories()` fallback: Returns categories with `trcloud_acc_code = null, trcloud_product_code = null`
- UI displays: "ยังไม่ได้ตั้งค่า GL Code" (graceful)
- Push validation: Blocks with clear error

**Scenario 2: Missing GL Code**
- Validation gate: `if (!category.trcloud_acc_code) throw 'GL Code ขาดหาย'`
- User sees: "GL Code ขาดหาย สำหรับ [category]" on "ส่ง TRCloud" tooltip

**Scenario 3: Missing SKU**
- Validation gate: `if (!category.trcloud_product_code) throw 'SKU ขาดหาย'`
- User sees: "SKU ขาดหาย สำหรับ [category]"

**Scenario 4: Branch TRCloud not configured**
- Validation gate: `if (!branch.trcloud_project || !branch.trcloud_department) throw 'ยังไม่ได้ตั้งค่า TRCloud สำหรับสาขา'`
- User sees tooltip: "ส่ง TRCloud ได้หลังตั้งค่า project + department ใน Settings > สาขา"

**Scenario 5: TRCloud API credential mismatch**
- API returns: `{errorCode: "AUTH_FAILED", message: "PASSKEY invalid"}`
- UI displays: "ยังไม่ได้ตั้งค่า TRCloud อย่างถูกต้อง กรุณาติดต่อ admin"

**Scenario 6: SKU not in TRCloud product master**
- API returns: `{errorCode: "SKU_NOT_FOUND", message: "JPS-100 not found"}`
- UI displays: "SKU JPS-100 ไม่พบใน TRCloud กรุณาติดต่อ admin"

---

## 5. User Stories & Workflows

### US-1: Accounting Staff — Confirm & Send Expense
**As** accountant  
**I want** to confirm an expense and immediately send it to TRCloud  
**So that** I don't have to re-enter data in the accounting system

**Acceptance Criteria:**
- AC1.1: Expense status = confirmed → "ส่ง TRCloud" button appears (if validations pass)
- AC1.2: Click "ส่ง TRCloud" → API called within 100ms
- AC1.3: Success: AP docNo returned + displayed inline within 30s
- AC1.4: Failure: Clear Thai error message shown (not generic 500 error)

**Steps:**
1. Open LedgerLine > Expense List
2. Click expense record
3. Click "Confirm" → Status changes to "confirmed"
4. "ส่ง TRCloud" button becomes enabled (if GL, SKU, branch config all set)
5. Click "ส่ง TRCloud"
6. Progress bar (30s)
7. Result: Toast "ส่ง TRCloud สำเร็จ AP-2026-000145" OR error message
8. On success: Inline status shows "synced" + docNo

---

### US-2: Admin — Set GL Code & SKU per Category
**As** org_admin  
**I want** to edit GL codes and SKU assignments for expense categories  
**So that** expenses are routed to the correct GL accounts and SKU in TRCloud

**Acceptance Criteria:**
- AC2.1: Settings > หมวดค่าใช้จ่าย > [category] → Edit modal opens
- AC2.2: GL Code field: 7-digit input, validated on blur (regex: `^\d{7}$`)
- AC2.3: SKU dropdown: Options = [JPS-100, JPS-101, JPS-103]
- AC2.4: VAT Claimable checkbox: Checked = tax_report=1, Unchecked = tax_report=0
- AC2.5: Save → `updateCategory()` → Success toast "บันทึกสำเร็จ"
- AC2.6: Display row updated immediately
- AC2.7: Invalid GL (non-digit / wrong length) → Red error "GL code ต้องเป็นตัวเลข 7 หลัก"

**Steps:**
1. Navigate to Settings > หมวดค่าใช้จ่าย
2. Click category (e.g., "ค่าน้ำ-ไฟ")
3. Click "Edit" button
4. GL Code field: Enter "5101010" (7 digits)
5. SKU dropdown: Select "JPS-100"
6. VAT Claimable: Check/uncheck as needed
7. Click "Save"
8. Modal closes, list updates with new values

---

### US-3: Branch Manager — Set TRCloud Project & Department
**As** branch_manager  
**I want** to configure my branch's TRCloud project and department  
**So that** expenses for my branch are posted to the correct cost center

**Acceptance Criteria:**
- AC3.1: Settings > สาขา > [branchId] → "TRCloud Config" section visible (if admin role)
- AC3.2: Fields: TRCloud Project (text input), TRCloud Department (text input)
- AC3.3: Both fields required (error if empty)
- AC3.4: Save button → `updateBranchTrcloudConfig()` → Success toast
- AC3.5: Validation: No special chars (alphanumeric + hyphen/underscore only)
- AC3.6: Display updated in next load
- AC3.7: LIFF admin console: Same fields (optional UI)

**Steps:**
1. Navigate to Settings > สาขา
2. Click branch (e.g., "Bangkok Store")
3. Scroll to "TRCloud Config" section
4. TRCloud Project: Enter "สาขา-Bangkok-001"
5. TRCloud Department: Enter "นิติบุคคล-JP-Sync-Ltd"
6. Click "Save"
7. Toast: "บันทึก TRCloud config สำเร็จ"

---

### US-4: CEO — Pre-Deployment Setup
**As** CEO  
**I want** to apply the migration, run the seed, and verify credentials  
**So that** v2 is ready for production

**Acceptance Criteria:**
- AC4.1: Migration applied: `ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_acc_code VARCHAR(7)`
- AC4.2: Migration applied: `ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_product_code VARCHAR(20)`
- AC4.3: Migration applied: `ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS vat_claimable BOOLEAN NOT NULL DEFAULT TRUE`
- AC4.4: Migration applied: `DELETE FROM ledger_trcloud_product` (clear old cache)
- AC4.5: Seed ran: `node scripts/seed-ledger-categories-jps.mjs` → 21 categories seeded
- AC4.6: Vercel env vars set: `TRCLOUD_JPS_COMPANY_ID`, `TRCLOUD_JPS_PASSKEY`, `TRCLOUD_JPS_ENCRYPT_HEAD`
- AC4.7: Test expense created, confirmed, pushed → AP docNo returned
- AC4.8: Rollback plan: Env vars removed = graceful failure (not 500)

---

### US-5: Admin Console (LIFF) — Bulk GL Upload
**As** super_admin  
**I want** to bulk upload GL codes for multiple categories at once  
**So that** I don't have to edit each one individually

**Acceptance Criteria (MVP):**
- AC5.1: LIFF admin console > "Upload GL Codes" button
- AC5.2: CSV format: `category_name,gl_code,sku,vat_claimable`
- AC5.3: Upload → Validation (GL 7-digit, SKU in enum, VAT boolean)
- AC5.4: Errors listed (row numbers, reasons)
- AC5.5: Success: Count of updated categories
- AC5.6: Progress bar: "% categories with GL + SKU"

---

## 6. Data Flow & System Integrations

### 6.1 Expense → Category → TRCloud

```
┌─────────────────────┐
│   ledger_entry      │
│ (expense record)    │
│                     │
│ - id                │
│ - category_id ──┐   │
│ - amount        │   │
│ - confirmed_at  │   └──> ┌──────────────────┐
│ - status        │        │ ledger_category  │
│ - trcloud_sync  │        │ (category config)│
│ - trcloud_docno │        │                  │
└─────────────────────┘     │ - trcloud_acc_code
                            │ - trcloud_product_code
                            │ - vat_claimable
                            └──────────────────┘
                                    │
                                    v
                            ┌──────────────────┐
                            │  TRCloud API     │
                            │  POST /ap/create │
                            │                  │
                            │ JSON payload:    │
                            │ - companyId: 45  │
                            │ - glCode (from   │
                            │   category)      │
                            │ - sku (from      │
                            │   category)      │
                            │ - amount         │
                            │ - taxReport      │
                            │   (from vat_cl)  │
                            └──────────────────┘
                                    │
                                    v
                            ┌──────────────────┐
                            │  TRCloud DB      │
                            │  (AP created)    │
                            │  docNo returned  │
                            └──────────────────┘
                                    │
                                    v
                            ┌──────────────────┐
                            │ ledger_entry     │
                            │ trcloud_sync =   │
                            │   "synced"       │
                            │ trcloud_docno =  │
                            │   "AP-2026-..."  │
                            └──────────────────┘
```

### 6.2 Branch Config Flow

```
Branch Manager sets TRCloud config
  ↓
updateBranchTrcloudConfig(branchId, {project, dept})
  ↓
branch_settings table: trcloud_project + trcloud_department
  ↓
loadExpenseDetail(expenseId) includes branch.{trcloud_project, trcloud_department}
  ↓
validatePushable() checks both fields exist
  ↓
pushExpenseToTrcloud() uses branch values for "projectCode" + "departmentCode"
  ↓
TRCloud AP created with correct cost center
```

---

## 7. Rollout & Deployment Plan

### Phase 1: Pre-Deployment Checklist (CEO)
- [ ] SQL migration applied in Supabase Dashboard
  ```sql
  ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_acc_code VARCHAR(7);
  ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS trcloud_product_code VARCHAR(20);
  ALTER TABLE ledger_category ADD COLUMN IF NOT EXISTS vat_claimable BOOLEAN NOT NULL DEFAULT TRUE;
  DELETE FROM ledger_trcloud_product;
  ```
- [ ] Seed script ran: `node scripts/seed-ledger-categories-jps.mjs`
- [ ] All 21 categories seeded with GL codes + SKU
- [ ] Vercel env vars set:
  - `TRCLOUD_JPS_COMPANY_ID` = "45"
  - `TRCLOUD_JPS_PASSKEY` = "[encrypted]"
  - `TRCLOUD_JPS_ENCRYPT_HEAD` = "[encrypted]"
- [ ] Test: Create expense → Confirm → "ส่ง TRCloud" → Verify AP docNo returned

### Phase 2: Rollout (Announcement)
- [ ] Email all accounting staff: "LedgerLine → TRCloud สง AP อัตโนมัติแล้ว"
- [ ] Screenshot: "ส่ง TRCloud" button location + workflow
- [ ] FAQ: "What if I see an error?"

### Phase 3: Monitoring (First Week)
- [ ] Daily: Check TRCloud AP count vs LedgerLine confirmed expenses
- [ ] Log all pushes: timestamp, user, expense, AP docNo, duration
- [ ] Alert if push failure rate > 5%

### Phase 4: Rollback (If Needed)
- [ ] Remove or flip Vercel env vars: `TRCLOUD_JPS_PASSKEY` deleted
- [ ] "ส่ง TRCloud" button becomes disabled + shows "ยังไม่ได้ตั้งค่า TRCloud"
- [ ] No data loss (migration is additive, only columns added)
- [ ] Revert seed categories: Run old script or manual update

---

## 8. Consistency & Compliance Checklist

### Design & UX
- [x] Uses LedgerLine design tokens (var(--color-brand-*), emerald actions)
- [x] Settings pages: Consistent with existing LedgerLine settings layout
- [x] Error messages: Thai language, user-friendly (not technical)
- [x] Mobile-responsive: All settings forms work on mobile (iOS/Android)
- [x] Accessibility: Form labels, keyboard navigation, ARIA roles

### Security & Permissions
- [x] Role-gating: `requireRole("super_admin","org_admin","admin")` on all settings pages
- [x] Company filtering: All queries filter by `companyId` (never falls back to org-wide)
- [x] JPS company 45 only: No shared company 31 integration
- [x] Credentials: All TRCLOUD_JPS_* vars in Vercel, never committed to repo
- [x] API auth: PASSKEY + ENCRYPT_HEAD in env, not code

### Data Integrity
- [x] service/no-stock (status=0): Never touches inventory (expenses routed to AP only)
- [x] Idempotency: Multiple "ส่ง TRCloud" clicks on same expense only create one AP docNo (duplicate check in TRCloud)
- [x] Validation gates: GL ✓, SKU ✓, branch config ✓ before push
- [x] Error fallbacks: Clear messaging, no silent failures
- [x] Audit trail: All syncs logged (timestamp, user, docNo, error if any)

### Integration Points
- [x] Shared `ledger_category` table: All new fields are nullable (backward compatible)
- [x] Shared `branch_settings` table: New fields `trcloud_project`, `trcloud_department`
- [x] No breaking changes to existing APIs or schemas
- [x] Defensive code: Migration fallbacks if columns missing

---

## 9. Risk Assessment & Mitigation

### P0 Risks (High Severity)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Migration not applied → new columns missing** | Push fails with "column not found" error | Defensive code in `loadPushable()` checks column existence; displays "ยังไม่ได้ตั้งค่า GL Code" without 500 error |
| **TRCloud API credentials invalid (PASSKEY/ENCRYPT_HEAD mismatch)** | All pushes fail with AUTH_FAILED | Clear error message to user: "ยังไม่ได้ตั้งค่า TRCloud อย่างถูกต้อง"; CEO checks Vercel env vars |
| **SKU (JPS-100/101/103) not in TRCloud product master** | Sync fails for all expenses using that SKU | Error message: "SKU JPS-100 ไม่พบใน TRCloud"; Admin contacts TRCloud support to add SKU |

### P1 Risks (Medium Severity)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Category missing GL code** | Expense cannot be synced; button disabled | UI validation gate; tooltip explains "GL Code ขาดหาย"; admin fixes in Settings |
| **Category missing SKU** | Expense cannot be synced; button disabled | UI validation gate; tooltip explains "SKU ขาดหาย"; admin selects from dropdown |
| **Branch missing TRCloud project/department** | Expense cannot be synced; button disabled | UI validation gate; tooltip explains "ตั้งค่า TRCloud ใน Settings > สาขา"; branch manager updates |
| **Shared company 31 accidentally included** | Data leakage to wrong legal entity | Query filter hardcoded: `WHERE company_id = 45` for JPS only; code review checklist |

### P2 Risks (Lower Severity)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Old `ledger_trcloud_product` table stale cache** | Incorrect SKU resolution | Migration includes `DELETE FROM ledger_trcloud_product`; no lookup from table (code-based enum instead) |
| **Multiple "ส่ง TRCloud" clicks create duplicate APs** | Double booking, reconciliation nightmare | TRCloud API checks docNo uniqueness; if re-sent, returns existing docNo (idempotent) |
| **User clicks "ส่ง TRCloud" before branch config set** | Button disabled but hidden error | Explicit tooltip: "ตั้งค่า TRCloud ใน Settings > สาขา ก่อนส่ง"; validation blocks push |

### P3 Risks (Low Severity)

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Network timeout during push (>30s)** | User sees "still loading"; retry unclear | Timeout + retry logic: 30s hard timeout, show "retry" button; log timeout for monitoring |
| **TRCloud API returns 5xx error** | All pushes fail temporarily | Graceful error: "TRCloud ไม่พร้อม ลองใหม่ในไม่ช่วงแล้ว"; retry button shown; monitoring alert triggered |
| **Admin updates category GL code while push in progress** | Push uses stale GL code? | Load category fresh on push start; if changed, reject + show error "Category changed, please retry" |

---

## 10. Acceptance Testing Plan

### Test Environment Setup
- **Database:** Supabase staging (copy of production)
- **API:** TRCloud staging environment (separate credentials)
- **Credentials:** `TRCLOUD_JPS_COMPANY_ID_STAGING`, `TRCLOUD_JPS_PASSKEY_STAGING`

### Test Scenarios

#### T1: Happy Path — Confirm & Sync
1. Create expense in LedgerLine (amount: THB 5,000, category: ค่าน้ำ-ไฟ)
2. Category has: GL code "5101010", SKU "JPS-100", VAT claimable ✓
3. Branch has: TRCloud project "สาขา-Bangkok", department "นิติบุคคล-JP"
4. Confirm expense
5. Click "ส่ง TRCloud"
6. **Expected:** AP created in TRCloud within 30s, docNo "AP-2026-000145" displayed, status = "synced"
7. **Verify:** TRCloud dashboard shows AP with correct GL, amount, VAT

#### T2: Validation — Missing GL Code
1. Create category "Test Expense" with SKU "JPS-100", VAT ✓, but GL = null
2. Create + confirm expense using this category
3. "ส่ง TRCloud" button should be disabled
4. **Expected:** Tooltip "GL Code ขาดหาย สำหรับ Test Expense"
5. Edit category in Settings, add GL "5101010", save
6. "ส่ง TRCloud" button now enabled
7. Click → Sync succeeds

#### T3: Validation — Missing SKU
1. Create category "Test Expense 2" with GL "5101010", VAT ✓, but SKU = null
2. Create + confirm expense
3. "ส่ง TรCloud" button disabled
4. **Expected:** Tooltip "SKU ขาดหาย สำหรับ Test Expense 2"
5. Edit category, select SKU "JPS-100", save
6. Button enabled → sync succeeds

#### T4: Validation — Branch Config Missing
1. Category + expense ready (GL ✓, SKU ✓)
2. Branch has trcloud_project = null
3. "ส่ง TRCloud" button disabled
4. **Expected:** Tooltip "ตั้งค่า TRCloud ใน Settings > สาขา"
5. Go to Settings > สาขา, fill in project + department, save
6. Button enabled → sync succeeds

#### T5: Error Handling — Invalid Credentials
1. Temporarily flip `TRCLOUD_JPS_PASSKEY` in Vercel
2. Try to push expense
3. **Expected:** Clear error toast: "ยังไม่ได้ตั้งค่า TRCloud อย่างถูกต้อง"
4. Revert PASSKEY
5. Push succeeds

#### T6: Error Handling — SKU Not in Product Master
1. Create category with SKU "JPS-999" (doesn't exist in TRCloud)
2. Try to push
3. **Expected:** Error toast "SKU JPS-999 ไม่พบใน TRCloud"
4. Fix category SKU to valid value
5. Retry succeeds

#### T7: Idempotency — Double-Click Protection
1. Create + confirm expense
2. Click "ส่ง TRCloud" twice quickly
3. **Expected:** First click returns docNo, second click returns same docNo (no duplicate AP)
4. Verify TRCloud shows only one AP record

#### T8: Mobile Responsive
1. Open Settings > หมวดค่าใช้จ่าย on iPhone 12
2. Edit form: GL input, SKU dropdown, VAT checkbox should all be usable
3. Save button triggers action
4. **Expected:** No layout breaks, form fully functional on mobile

#### T9: Permission Gating
1. Log in as "accountant" (not admin)
2. Navigate to Settings > หมวดค่าใช้จ่าย
3. **Expected:** Page shows "403 Forbidden" or category list is read-only
4. Cannot click "Edit" button
5. Log in as admin → Edit available

#### T10: Migration Fallback
1. Temporarily remove `trcloud_acc_code` column (undo migration)
2. Load category list
3. **Expected:** No 500 error; categories load, GL field shows null or "-"
4. UI gracefully handles missing field
5. Re-apply migration

### Acceptance Sign-off
- [ ] QA: All T1–T10 pass on staging
- [ ] Admin: Verifies GL codes in seed match TRCloud chart of accounts
- [ ] Admin: Confirms all 3 SKUs (JPS-100/101/103) exist in TRCloud product master
- [ ] CEO: Reviews credentials, approves deployment
- [ ] Accounting staff: Trained on "ส่ง TRCloud" workflow

---

## 11. Success Metrics & KPI Tracking

### Primary KPIs (First 2 Weeks Post-Launch)
| KPI | Target | Measurement |
|-----|--------|-------------|
| **API Success Rate** | ≥ 98% | `count(sync_status="synced") / count(sync_attempted)` |
| **Average Push Duration** | ≤ 5s | `avg(push_end_time - push_start_time)` |
| **P95 Push Duration** | ≤ 30s | `percentile(push_duration, 0.95)` |
| **SKU Resolution Success** | = 100% | All 3 SKUs found in product master |
| **Category GL Coverage** | ≥ 100% | All seeded categories have GL code |
| **Branch Config Coverage** | ≥ 95% | % of branches with project + department set |
| **Accounting Staff Adoption** | ≥ 80% | % of confirmed expenses pushed (not manual export) |
| **Data Rework Rate** | = 0% | Manual entry in TRCloud after LedgerLine sync (should be zero) |

### Monitoring & Alerting
- [ ] Daily report: Count of synced vs failed pushes
- [ ] Weekly: Error breakdown (missing GL, missing SKU, API errors, network timeouts)
- [ ] Alert if: Single push takes > 60s OR success rate drops below 95%
- [ ] Dashboard: LedgerLine → TRCloud sync status (real-time)

---

## 12. Documentation & Training

### User Documentation
- [ ] **Quick Start Guide:** Settings > หมวดค่าใช้จ่าย + Settings > สาขา (PDF, Thai)
- [ ] **FAQ:** "What does 'ส่ง TRCloud' do?" "Why is the button disabled?" "What if push fails?"
- [ ] **Video:** 2-min demo of expense → confirm → sync workflow (LINE LIFF)
- [ ] **Troubleshooting:** Common errors + how to fix (admin manual)

### Admin Documentation
- [ ] **Setup Checklist:** Pre-deployment tasks (migration, seed, env vars)
- [ ] **API Reference:** TRCloud endpoint, payload, response, error codes
- [ ] **Monitoring Guide:** Where to check sync logs, how to troubleshoot
- [ ] **Rollback Procedure:** If deployed, how to disable gracefully

### Code Documentation
- [ ] **lib/ledger/trcloud-push.ts:** JSDoc comments on all functions
- [ ] **_actions.ts:** Inline comments on loadPushable, validatePushable flows
- [ ] **CategoryManager UI:** Comments on GL validation, SKU dropdown logic
- [ ] **Branch Config UI:** Comments on project/department validation

---

## 13. Appendix: Technical Details

### A. Environment Variables (Reference)
```bash
# TRCloud JPS Company 45 Credentials (Vercel Production Only)
TRCLOUD_JPS_COMPANY_ID="45"
TRCLOUD_JPS_PASSKEY="[encrypted-base64-string]"
TRCLOUD_JPS_ENCRYPT_HEAD="[aes-iv-hex]"
TRCLOUD_API_ENDPOINT="https://trcloud.jpsync.co.jp/api/v2"

# Feature Flags (optional)
FEATURE_LEDGER_TRCLOUD_V2="true"
LEDGER_TRCLOUD_TIMEOUT_MS="30000"
```

### B. Database Query Examples

**List categories with GL/SKU:**
```sql
SELECT id, name, trcloud_acc_code, trcloud_product_code, vat_claimable
FROM ledger_category
WHERE company_id = 45
ORDER BY name;
```

**List pushable expenses (confirmed, not yet synced):**
```sql
SELECT e.id, e.amount, c.trcloud_acc_code, c.trcloud_product_code
FROM ledger_entry e
JOIN ledger_category c ON e.category_id = c.id
WHERE e.company_id = 45
  AND e.status = 'confirmed'
  AND (e.trcloud_sync_status IS NULL OR e.trcloud_sync_status = 'pending')
  AND c.trcloud_acc_code IS NOT NULL
  AND c.trcloud_product_code IS NOT NULL;
```

**Check branch TRCloud config:**
```sql
SELECT b.id, b.name, b.trcloud_project, b.trcloud_department
FROM branch b
WHERE b.company_id = 45
  AND (b.trcloud_project IS NULL OR b.trcloud_department IS NULL);
```

### C. SKU Mapping (Definitive)

| SKU Code | Display Name | Use Case | tax_report Value |
|----------|--------------|----------|------------------|
| JPS-100 | Standard Expense | Most operational expenses (utilities, supplies, etc.) | per category vat_claimable |
| JPS-101 | VAT-Claimable Import | Goods/services with VAT (imported items, equipment) | 1 (always) |
| JPS-103 | Non-VAT Expense | Wages, penalties, non-claimable items | 0 (always) |

### D. GL Code Validation Rules
- **Format:** 7 digits (0-9), no letters, no special chars
- **Pattern:** `^\d{7}$`
- **Example:** "5101010" (ค่าน้ำ-ไฟ)
- **Invalid:** "10100" (too short), "5101-010" (special char), "5101010A" (letter)

### E. Sample Seed Data (First 5 of 21)

```javascript
[
  {
    name: "ค่าน้ำ-ไฟ",
    company_id: 45,
    trcloud_acc_code: "5101010",
    trcloud_product_code: "JPS-100",
    vat_claimable: true
  },
  {
    name: "ค่าสูทรกาส",
    company_id: 45,
    trcloud_acc_code: "5101020",
    trcloud_product_code: "JPS-100",
    vat_claimable: true
  },
  {
    name: "ค่าโทรศัพท์",
    company_id: 45,
    trcloud_acc_code: "5101030",
    trcloud_product_code: "JPS-103",
    vat_claimable: false
  },
  {
    name: "ค่าบริการทำความสะอาด",
    company_id: 45,
    trcloud_acc_code: "5101040",
    trcloud_product_code: "JPS-100",
    vat_claimable: true
  },
  {
    name: "ค่าซ่อมแซม",
    company_id: 45,
    trcloud_acc_code: "5101050",
    trcloud_product_code: "JPS-100",
    vat_claimable: true
  }
  // ... 16 more categories
]
```

### F. Error Code Reference (TRCloud API)

| Error Code | HTTP | Message (Thai) | Action |
|-----------|------|----------------|--------|
| VALIDATION_FAILED | 400 | `[fieldName] ไม่ถูกต้อง` | Fix input, retry |
| AUTH_FAILED | 401 | `ยังไม่ได้ตั้งค่า TRCloud อย่างถูกต้อง` | Check credentials in Vercel |
| SKU_NOT_FOUND | 422 | `SKU [code] ไม่พบใน TRCloud` | Add SKU to TRCloud, contact admin |
| GL_NOT_FOUND | 422 | `GL Code [code] ไม่พบ` | Add GL to chart of accounts in TRCloud |
| RATE_LIMIT | 429 | `ส่งได้เร็วเกินไป ลองใหม่ในไม่ช่วงแล้ว` | Wait 60s, retry |
| INTERNAL_ERROR | 500 | `ข้อผิดพลาดบน TRCloud ลองใหม่ในไม่ช่วงแล้ว` | Retry, contact TRCloud support |

---

## 14. Sign-Off & Approval

### Engineering Sign-Off
- [ ] **Senior Developer:** Code review complete, all lib/trcloud-push.ts functions tested locally
- [ ] **QA Lead:** All 10 test scenarios passed on staging
- [ ] **DevOps:** Env vars configured in Vercel, rollback plan documented

### Business Sign-Off
- [ ] **CEO:** Migration applied, seed ran, credentials verified, test push succeeded
- [ ] **Accounting Manager:** Training completed, staff ready for go-live
- [ ] **TRCloud Admin:** Confirmed SKUs + GL codes exist in product master + chart of accounts

### Launch Checklist
- [ ] Git commit: Feature code merged to main
- [ ] Vercel deployment: Auto-deploy from main to production
- [ ] Monitoring: Alerts configured (API error rate, push duration)
- [ ] Communication: Email + LINE notification to all accounting staff
- [ ] Support: On-call team briefed on troubleshooting

**Approved by:** [Name]  
**Date:** 2026-06-07  
**Deployment Target:** JP Sync company 45 (Production)  

---

## 15. Rollback & Contingency

### Rollback Trigger
- API success rate < 90% for 1 hour OR
- Critical data corruption reported OR
- Security breach detected

### Rollback Steps (5 min SLA)
1. DevOps: Delete or comment out `TRCLOUD_JPS_PASSKEY` in Vercel
2. Deploy: Next auto-deploy picks up env change (or manual force-deploy)
3. User Experience: "ส่ง TRCloud" button disabled, tooltip "ยังไม่ได้ตั้งค่า TRCloud"
4. Verification: Confirm no new pushes are attempted
5. Communication: Notify accounting staff (feature temporarily disabled)

### Data Safety
- No production data modified by this feature (only reads + creates AP in TRCloud)
- Migration is additive (columns added, never deleted)
- Rollback = feature disabled, NOT data deleted
- Historical AP records in TRCloud remain (no delete operation)

---

## End of Specification

**Document ID:** BIGFEATURE_ledger-trcloud-v2_SPEC  
**Version:** 1.0  
**Last Updated:** 2026-06-07  
**Next Review:** Post-launch (2026-06-14)

