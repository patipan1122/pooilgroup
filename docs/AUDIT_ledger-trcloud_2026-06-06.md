# AUDIT · LedgerLine→TRCloud Push · 2026-06-06

---

## 1. Executive Summary

ระบบ LedgerLine→TRCloud Push v2 (JP Sync company 45) ถูกสร้างขึ้นเพื่อให้พนักงานถ่ายรูปใบเสร็จผ่าน LINE แล้ว accountant ยืนยันและกด push เข้า TRCloud เป็น AP อัตโนมัติ โครงสร้างหลัก (VAT-inclusive, draft AP, per-branch project/dept, 3 fixed SKUs) ถูกต้องและ audit trail บน happy path ครบถ้วน อย่างไรก็ตามการ audit พบ **3 P0 blockers** ที่ต้องแก้ก่อน go-live: (1) `TRCloudBranchConfig` หายไปจาก LIFF admin console ทำให้ admin mobile ผูก branch ไม่ได้, (2) `loadPushable` และ single-push path ไม่มี `companyId` filter ทำให้มีความเสี่ยง cross-company VAT leak, (3) contact fallback ไปยัง `list[0]` อาจผูก AP กับเจ้าหนี้ผิดราย นอกจากนี้ยังมี P1 issues รอ sprint ถัดไปอีก 8 รายการ

---

## 2. Scope

**IN:** `lib/ledger/trcloud-push.ts` · `app/(admin)/ledger/_actions.ts` (push actions) · `CategoryManager.tsx` · `TRCloudBranchConfig.tsx` · `settings/page.tsx` · `AdminConsole.tsx` · `ExpenseList.tsx` · `seed-ledger-categories-jps.mjs`

**OUT:** TRCloud web UI · LINE bot flow (receipt capture) · Supabase RLS policies · Payment/quotation module

**DEFERRED:** WHT (ภาษีหัก ณ ที่จ่าย) per-category · Reconciliation dashboard · `/ledger/trcloud` overview page · `deleteTrcloudAp` UI

---

## 3. Architecture

```
LINE Staff → photo → ledger_expense (draft)
                         ↓
Accountant confirm → ledger_expense (confirmed/locked)
                         ↓
sendExpenseToTrcloud() ← _actions.ts (capability: expense.export)
    ↓
trcloud-push.ts
  resolveContactId() → DB cache → TRCloud contact/search → contact/create
  resolveFixedSku()  → DB cache → TRCloud inventory/search
  buildLines()       → VAT proportional dist, tax_option="in"
  POST ap/create.php → JPS_AP format, approve_status="wait"
    ↓
stamp trcloudDocId + trcloudDocNo + trcloudPushedAt → ledger_expense
```

**Key facts baked in:** company_id=45 (JP Sync), 3 SKUs (JPS-100/101/103), MD5 auth (`ENCRYPT_HEAD + "t" + timestamp`), AP always draft, `tax_report` controlled by `inputVatClaimable` flag.

---

## 4. Sitemap

| Page / Surface | ใครใช้ | ทำไม | สถานะปัจจุบัน |
|---|---|---|---|
| `/ledger/settings` → CategoryManager | Admin/Accountant | ผูก GL+SKU+VAT per category | ✅ มีแล้ว |
| `/ledger/settings` → TRCloudBranchConfig | Admin | ผูก project/dept per branch | ✅ web เท่านั้น |
| `/ledger/expenses` → filter "ยังไม่ส่ง" | Accountant | daily push operations | ✅ มีแล้ว |
| `ExpensePaneClient.tsx` → single push | Accountant | push รายการเดียว | ❌ action มีแต่ไม่ wire |
| LIFF `/liff/ledger/admin` → TRCloud config | Admin mobile | ผูก branch บนมือถือ | ❌ ไม่มี |
| `/ledger/trcloud` dashboard | CEO/Accountant | aggregate push status | ❌ ไม่มี (DEFERRED) |

---

## 5. ASCII Wireframes

### Settings: TRCloud Tab

```
┌─ Settings: TRCloud ─────────────────────────────────────┐
│ [หมวดหมู่] [สาขา]                                        │
├──────────────────────────────────────────────────────────┤
│ ⚠ 1 หมวดยังไม่มี SKU · 3 สาขายังไม่ผูก                  │
│ ชื่อ            GL       SKU         VAT   สถานะ          │
│ ค่าน้ำมัน       5200    [JPS-100▾]   ☑    ●เปิด [✎]      │
│ ค่าเช่า         5100    [JPS-101▾]   ☐    ●เปิด [✎]      │
│ ค่าซ่อม         5300    [— ไม่มี  ]  ☑    ⚠ SKU [✎]      │
└──────────────────────────────────────────────────────────┘
```

### ExpenseList: Push Status Column

```
┌────────┬──────────┬──────────┬─────────────────────────┐
│ วันที่  │ หมวด     │ จำนวน    │ TRCloud                 │
├────────┼──────────┼──────────┼─────────────────────────┤
│ 05/06  │ ค่าน้ำมัน│ ฿450     │ ✓ JPS-AP-2026-0042 [↗] │
│ 04/06  │ ค่าซ่อม  │ ฿3,200   │ ⚠ ไม่มี SKU   [ตั้งค่า]│
│ 04/06  │ ค่ารับรอง│ ฿800     │ — ยังไม่ส่ง      [ส่ง] │
│ 03/06  │ ค่าน้ำมัน│ ฿380     │ ✗ API error   [ลองอีก] │
└────────┴──────────┴──────────┴─────────────────────────┘
```

---

## 6. Acceptance Criteria

| # | AC | Status |
|---|---|---|
| AC-01 | Happy path single push: confirmed+configured → badge "ส่งแล้ว" + `trcloudDocNo` ภายใน 5s | 🟡 docNo ไม่แสดง |
| AC-02 | Zero-VAT push: `vatClaimable=false` → AP line มี `vat:"0"` + `tax_report="0"` | 🟡 perfix fixed แต่ต้อง verify sandbox |
| AC-03 | Unconfigured branch → error + deep-link ไป settings | ❌ TODO |
| AC-04 | SKU unset → block before POST + actionable Thai error | 🟡 block มี แต่ msg ไม่ actionable |
| AC-05 | Duplicate push → `alreadySent:true` + docNo แสดงใน toast | 🟡 alreadySent ✅ แต่ไม่ return docNo |
| AC-06 | Bulk partial fail: 8 ok + 2 fail → toast summary + failed rows มี error badge | 🟡 counter ✅ stamp per-row ต้อง verify |
| AC-07 | ExpenseList: 3 states ชัด (unsent / sent+docNo / failed+error) | ❌ docNo แสดง UUID ไม่ใช่ docNo |
| AC-08 | Audit log: `PUSHED` + `PUSH_FAILED` + before/after GL ใน CATEGORY_UPDATED | 🟡 push log ✅ before/after missing |
| AC-09 | LIFF admin "ตั้งค่า" มี TRCloudBranchConfig พร้อม save จาก mobile | ❌ ไม่มี |
| AC-10 | CategoryManager แสดง 21 seed categories + `active` field จาก DB (ไม่ hardcode) | ❌ active hardcode `true` |

---

## 7. Sign-off Table

| Persona | Verdict | Conditions / Blockers | Key Finding |
|---|---|---|---|
| Security (Multi-tenant) | 🟡 CONDITIONAL | `loadPushable` ต้องเพิ่ม `companyId` filter; single-push ต้องตรวจ companyId; `updateBranchTrcloud` ต้องใช้ typed Zod merge | Cross-company push risk บน single-push path |
| Performance (Arch) | 🟡 CONDITIONAL | Fix bulk N+1 (batch `findMany` ก่อน loop); limit batch ≤20; add Serverless maxDuration=30s | `loadPushable` ใน loop = N+1 DB queries; contact fallback ไป `list[0]` ต้องลบออก |
| Finance/Accounting | 🟡 CONDITIONAL | Verify zero-VAT + `tax_report` กับ TRCloud sandbox; ตัดสินใจ WHT policy; แก้ due_date บน credit AP | `tax_option="in"` + `tax_report="0"` อาจขัดแย้งกัน; WHT ไม่มีเลย |
| UX/Mobile | 🔴 BLOCKED | เพิ่ม TRCloudBranchConfig ใน AdminConsole.tsx; error message ต้องมี deep-link; เพิ่ม single-push ใน detail pane | Admin mobile ผูก branch ไม่ได้เลย = hard blocker |
| QA (Functional) | 🟡 CONDITIONAL | Fix docNo display (UUID→docNo); verify bulk loop stamps trcloudError per-row; test zero-VAT sandbox; add startup env log | docNo ไม่แสดง = functional failure ไม่ใช่แค่ UX |
| Audit/Compliance | 🟡 CONDITIONAL | เพิ่ม bulk-session audit log; block edit หลัง push (หรือ warn+override); before/after value ใน CATEGORY_UPDATED | ไม่มี session-level bulk push audit = audit trail ไม่สมบูรณ์ |
| Data Integrity | 🟡 CONDITIONAL | Zod validation บน Branch.settings keys; เพิ่ม companyId ใน loadPushable; สร้าง reconciliation view (read-only) | Branch.settings typo = silent wrong-project push |
| End User (Staff) | 🟡 CONDITIONAL | LINE notification เมื่อ confirm/push; Thai error message map; เพิ่มหมวด "ค่าใช้จ่ายอื่นๆ" catch-all | Staff ไม่รู้ว่า expense ถูก process แล้วหรือยัง |

---

## 8. Remaining P1/P2 Issues

| # | Priority | File | Issue |
|---|---|---|---|
| R-01 | P1 | `ExpensePaneClient.tsx` | ไม่มี single-push button — wire `sendExpenseToTrcloud(id)` |
| R-02 | P1 | `settings/page.tsx` line 66 | `active: true` hardcode — ส่ง actual `active` จาก DB |
| R-03 | P1 | `_actions.ts` bulk loop | Bulk N+1: เปลี่ยนเป็น batch `findMany` ก่อน loop |
| R-04 | P1 | `_actions.ts` | เพิ่ม bulk-session audit log (who, count, timestamp, results) |
| R-05 | P1 | `_actions.ts` | Block/warn แก้ไข expense ที่มี `trcloudPushedAt` แล้ว |
| R-06 | P1 | `trcloud-push.ts` | Thai error message map (raw API error → ภาษาคน) |
| R-07 | P1 | `TRCloudBranchConfig.tsx` | เพิ่ม `grid-cols-1 sm:grid-cols-3` responsive breakpoint |
| R-08 | P2 | `trcloud-push.ts` | `due_date` ควรต่างจาก `issue_date` สำหรับ credit AP |
| R-09 | P2 | `ExpenseList.tsx` | แสดง trcloudDocNo แทน UUID (copy-to-clipboard button) |
| R-10 | P2 | `seed-ledger-categories-jps.mjs` | เพิ่มหมวด "ค่าใช้จ่ายอื่นๆ" catch-all (SKU=JPS-103) |

---

## 9. Locked Decisions

**D-TRC-01:** `approve_status="wait"` hardcode เสมอ — accountant ต้องอนุมัติใน TRCloud เอง ห้าม auto-approve

**D-TRC-02:** 3 SKUs เท่านั้น (JPS-100/101/103) — ห้ามสร้าง SKU ใหม่ใน TRCloud โดยไม่ผ่าน CFO approval

**D-TRC-03:** `tax_option="in"` (VAT-inclusive) คงที่ — ตรงกับ JPS AP format ที่ใช้งานจริง

**D-TRC-04:** Branch TRCloud config เก็บใน `Branch.settings` JSON — DEFERRED migration เป็น typed columns ไว้ post-MVP

**D-TRC-05:** WHT ไม่ส่งใน v2 — accountant กรอกเองใน TRCloud; ต้องประชุม CEO+accountant ก่อน implement

---

## 10. Next Steps

**Sprint ถัดไป (P0 — ต้องทำก่อน go-live):**

1. **`AdminConsole.tsx`** — import `TRCloudBranchConfig`, เพิ่ม chip-rail "สาขา" ใน "ตั้งค่า" tab; fetch `branchesFull` พร้อม `settings` ใน `admin/page.tsx` (~40 LOC)
2. **`_actions.ts`** — เพิ่ม `companyId` ใน `loadPushable` WHERE clause; เพิ่ม `companyId` check ใน `sendExpenseToTrcloud` single path (~10 LOC)
3. **`trcloud-push.ts`** — ลบ contact `list[0]` fallback; ถ้า tax_id ไม่ match ให้ create ใหม่เสมอ (~5 LOC)
4. **`updateBranchTrcloud`** — เปลี่ยน raw JSON merge เป็น Zod-validated typed pick ของ trcloud keys เท่านั้น (~15 LOC)
5. **TRCloud sandbox test** — verify `vat:"0"` + `tax_report="0"` พร้อมกันกับ JPS sandbox; document ผล

**Sprint ถัดๆ ไป (P1):**
- Wire single-push ใน `ExpensePaneClient.tsx`
- Fix `active` hardcode ใน settings page
- เพิ่ม bulk-session audit log
- Thai error message map
- LINE notification กลับ staff เมื่อ confirm/push
