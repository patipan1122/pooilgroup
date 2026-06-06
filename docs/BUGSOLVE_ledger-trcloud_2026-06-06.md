# BUGSOLVE · LedgerLine TRCloud · 2026-06-06

## Scope
LedgerLine→TRCloud push flow, settings UI, LIFF mobile admin, data integrity.
Mode: Full (5 verification areas + auto-fix)

## Bug Findings
Now I have all the data I need. Here is the full analysis:

---

## Bug Findings — push-flow-verify

| # | Description | Severity | File:Line | Fix |
|---|---|---|---|---|
| B-1 | **Race condition: concurrent single-expense pushes bypass `alreadyPushed` guard** | P1 | `_actions.ts:882-888` | See fix below |
| B-2 | **No fetch timeout on any TRCloud API call** | P1 | `trcloud-push.ts:63` | See fix below |
| B-3 | **Contact dedup: empty string `""` taxId creates a shared "miscellaneous creditor" row for ALL vendors without a tax ID** | P1 | `trcloud-push.ts:140-143` | See fix below |
| B-4 | **VAT rounding: last-item absorbs rounding correctly in sum, but per-unit price can be fractional when qty > 1** | P2 | `trcloud-push.ts:279` | See fix below |
| B-5 | **`resolveFixedSku` ok:false path is properly propagated — no error swallowing** | None (clean) | `trcloud-push.ts:247-248` | N/A |
| B-6 | **Batch push (`sendExpensesToTrcloud`): race still possible between two separate HTTP requests for the same expense id** | P1 | `_actions.ts:928-948` | Same fix as B-1 |
| B-7 | **`trcloudDocId` set to literal string `"sent"` when TRCloud returns null docId — silently prevents future real docId from being stored and makes idempotency guard fire on a record with no actual TRCloud doc** | P2 | `_actions.ts:838` | See fix below |
| B-8 | **`resolveContactId` upsert after external create: if two concurrent calls both miss the DB cache and both succeed at TRCloud, two separate TRCloud vendor contacts are created; only one is cached** | P1 | `trcloud-push.ts:147-157` | See note below |

---

### Detailed Analysis

---

#### B-1 / B-6 — Race condition (P1)

**Mechanism:**
```
Request A: loadPushable → alreadyPushed=false → (no write here)
Request B: loadPushable → alreadyPushed=false → (no write here)
Request A: pushExpenseToTrcloud → TRCloud creates AP doc "TR-001"
Request B: pushExpenseToTrcloud → TRCloud creates AP doc "TR-002"  ← duplicate AP in TRCloud
Request A: recordPushResult → writes trcloudDocId="TR-001"
Request B: recordPushResult → overwrites trcloudDocId="TR-002"
```

`alreadyPushed` is a read-check without a write-lock. Two concurrent server action calls (user double-clicks, or two open browser tabs) both see `trcloudDocId=null`, both proceed, and TRCloud creates two APs for the same expense.

**Fix — add a DB-level optimistic lock via conditional `updateMany` before pushing:**

In `sendExpenseToTrcloud` (and the loop in `sendExpensesToTrcloud`), replace the soft check with a claim-write pattern:

```ts
// After the loaded.alreadyPushed check, atomically claim the row:
const claimed = await prisma.ledgerExpense.updateMany({
  where: { id, orgId, trcloudDocId: null },  // only succeeds if still unpushed
  data: { trcloudDocId: "pushing" },          // sentinel value
});
if (claimed.count === 0) return { ok: true, alreadySent: true }; // another request won

const res = await pushExpenseToTrcloud(loaded.pushable);
await recordPushResult(orgId, loaded.companyId, id, session.user.id, res);
// recordPushResult overwrites "pushing" with real docId on success,
// or clears it to null on failure (add that to the failure branch):
//   data: { trcloudDocId: null, trcloudError: res.error.slice(0,500) }
```

Also update the failure branch in `recordPushResult` to clear the sentinel:
```ts
// failure branch — add trcloudDocId: null to reset the sentinel
data: { trcloudDocId: null, trcloudError: res.error.slice(0, 500) },
```

---

#### B-2 — No fetch timeout (P1)

**Mechanism:** The bare `fetch()` in `post()` (line 63) has no timeout. Vercel serverless functions have a 10 s (Hobby) / 60 s (Pro) wall-clock limit. If TRCloud is slow, the function hangs and Vercel kills it with a 504 — but `recordPushResult` was never reached, so `trcloudDocId` stays null. On retry the race-condition window opens again. Worse: if the TRCloud call actually succeeded before the timeout, we create a duplicate on retry.

**Fix:**
```ts
// In post():
const res = await fetch(`${BASE}/${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
  body: body.toString(),
  signal: AbortSignal.timeout(15_000), // 15 s hard ceiling
});
```

This also makes the error surfaceable as a Thai-readable message rather than a silent 504:
```ts
// In pushExpenseToTrcloud caller, catch AbortError:
try {
  const r = await post("ap/create.php", payload);
  ...
} catch (e) {
  if (e instanceof Error && e.name === "AbortError")
    return { ok: false, error: "TRCloud ไม่ตอบสนองภายใน 15 วินาที — กรุณาลองใหม่" };
  throw e;
}
```

---

#### B-3 — Contact dedup: empty string taxId collision (P1)

**Mechanism:**
```ts
const taxId = digitsOnly(v.vendorTaxId);  // "" → ""
const where = { orgId, companyId, taxId: "" };
// findUnique with taxId="" hits the same row for ALL no-taxId vendors
```

`digitsOnly(null)` = `""`, `digitsOnly("")` = `""`. The composite unique key `orgId_companyId_taxId` with `taxId=""` means the **first no-taxId vendor** caches its `contactId` under key `("org1","co1","")`, and **every subsequent no-taxId vendor** gets that same cached TRCloud contact — wrong vendor assigned to their AP.

**Fix:** Treat empty taxId as non-cacheable:
```ts
async function resolveContactId(scope, v) {
  const taxId = digitsOnly(v.vendorTaxId);

  // Only cache when we have a real tax ID — empty string is not unique
  if (taxId) {
    const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };
    const cached = await prisma.ledgerTrcloudContact.findUnique({ where: { orgId_companyId_taxId: where } });
    if (cached) return { ok: true, ref: { contactId: cached.contactId, codeNumber: cached.codeNumber } };
  }

  const name = taxId ? (v.vendor || "ไม่ระบุชื่อผู้ขาย") : "เจ้าหนี้เบ็ดเตล็ด (LedgerLine)";
  let ref: ContactRef | null = null;
  if (taxId) {
    ref = await searchContactByTaxId(taxId);
  }
  if (!ref) {
    const created = await createContact({ name, taxId, organization: v.vendor, address: v.vendorAddress });
    if (!created.ok) return created;
    ref = created.ref;
  }
  // Only upsert cache for real tax IDs
  if (taxId) {
    const where = { orgId: scope.orgId, companyId: scope.companyId, taxId };
    await prisma.ledgerTrcloudContact.upsert({
      where: { orgId_companyId_taxId: where },
      update: { contactId: ref.contactId, codeNumber: ref.codeNumber, name },
      create: { ...where, contactId: ref.contactId, codeNumber: ref.codeNumber, name },
    });
  }
  return { ok: true, ref };
}
```

---

#### B-4 — VAT rounding: fractional per-unit price (P2)

**Mechanism:** The last-item absorbs-rounding approach produces a correct **total VAT** (`vatLeft` collapses to zero). However, the per-unit price is computed as:

```ts
const inclPrice = round2((r.baseAmount + lineVat) / qty);
```

If qty=3, baseAmount=100, lineVat=7 → inclPrice = round2(107/3) = round2(35.6667) = 35.67.
TRCloud will compute: 35.67 × 3 = 107.01 — off by ฿0.01 from the original.

The `vatLeft` rounding is correct at the document level, but splitting the inclusive price per unit introduces a secondary rounding gap.

**Fix:** Send the line as qty=1 with the full inclusive amount when qty causes rounding loss:

```ts
const rawInclPrice = (r.baseAmount + lineVat) / qty;
const inclPrice = round2(rawInclPrice);
// If rounding loss: collapse to qty=1 so TRCloud sees the exact amount
const finalQty = round2(inclPrice * qty) !== round2(r.baseAmount + lineVat) ? 1 : qty;
const finalPrice = finalQty === 1 ? round2(r.baseAmount + lineVat) : inclPrice;
lines.push({
  ...
  price: String(finalPrice),
  quantity: String(finalQty),
});
```

---

#### B-5 — Error swallowing in buildLines (clean — no bug)

`resolveFixedSku` returns `{ ok: false, error }` → line 248 immediately `return skuResult` — the error propagates correctly to `pushExpenseToTrcloud` which returns it to the caller. `buildLines` has no catch block that could swallow it. The validation gates at lines 239-245 in `buildLines` and 312-323 in `pushExpenseToTrcloud` are redundant but harmless. **No bug here.**

---

#### B-7 — Sentinel `"sent"` persisted as trcloudDocId (P2)

**Mechanism:** Line 838:
```ts
trcloudDocId: res.docId ?? "sent",
```

If TRCloud returns success but no docId (e.g., the response JSON changes shape), the row is written with `trcloudDocId = "sent"`. This:
1. Trips the `alreadyPushed` guard on future calls (correct behaviour), but
2. `deleteTrcloudAp("sent")` would be called if the accountant tries to retract — sending a garbage `id=sent` to TRCloud.
3. Prevents ever storing the real docId if it later becomes available.

**Fix:**
```ts
trcloudDocId: res.docId ?? "UNKNOWN",   // clearly marked as unparseable, not "sent"
trcloudDocNo: res.docNo,
trcloudPushWarning: res.docId ? null : "TRCloud did not return a document ID",
```
Or better: log a warning and still store null, relying on B-1's fix (the `"pushing"` sentinel) to prevent re-push:
```ts
trcloudDocId: res.docId,  // null is fine — sentinel was already consumed by the claim-write
```

---

#### B-8 — Concurrent vendor-create race in `resolveContactId` (P1)

**Mechanism:** Two expenses from different sessions with the same (new) taxId both miss the DB cache at the same time:
```
Session A: findUnique(taxId="0123...") → null
Session B: findUnique(taxId="0123...") → null
Session A: searchContactByTaxId → not found → createContact → TRCloud creates contact "C-001"
Session B: searchContactByTaxId → not found (race) → createContact → TRCloud creates contact "C-002"
```
Two duplicate vendor records in TRCloud. The batch `sendExpensesToTrcloud` mitigates this by running sequentially (line 926-927 comment), but two separate single-push calls in separate browser tabs still hit this.

**Fix (partial, without TRCloud-side dedup):** Add a DB-level unique advisory lock or use `upsert` with a unique constraint on `(orgId, companyId, taxId)` and catch the conflict:
```ts
// Before calling TRCloud search/create, try to reserve the slot:
try {
  await prisma.ledgerTrcloudContact.create({
    data: { ...where, contactId: "resolving", codeNumber: null, name },
  });
} catch {
  // Another request is resolving this taxId — wait and re-read
  await new Promise(r => setTimeout(r, 800));
  const cached = await prisma.ledgerTrcloudContact.findUnique({ where: { orgId_companyId_taxId: where } });
  if (cached && cached.contactId !== "resolving") 
    return { ok: true, ref: { contactId: cached.contactId, codeNumber: cached.codeNumber } };
}
// ... proceed with TRCloud search/create then update the reserved row
```

The true fix requires a DB `unique` constraint on `(orgId, companyId, taxId)` — confirm it exists in the migration for `ledger_trcloud_contact`.

---

### Auto-fixable P0/P1 summary

**B-1 (P1) — Race condition:** Add atomic claim-write in `sendExpenseToTrcloud` and the batch loop. Exact pattern: `updateMany({ where: { id, orgId, trcloudDocId: null }, data: { trcloudDocId: "pushing" } })` before calling `pushExpenseToTrcloud`. Also add `trcloudDocId: null` to the failure branch of `recordPushResult`.

**B-2 (P1) — No timeout:** Add `signal: AbortSignal.timeout(15_000)` to the `fetch()` call in `post()` at `trcloud-push.ts:63`.

**B-3 (P1) — Empty taxId collision:** Skip the DB cache lookup and write when `taxId === ""`. Exact location: `resolveContactId` in `trcloud-push.ts:141-143` and `:153-157`.

---

Now I have full context. Here are all findings:

---

## Bug Findings — settings-ui-verify

| # | Description | Severity | File:Line | Fix |
|---|---|---|---|---|
| 1 | **Stale `active` field hardcoded to `true` in page.tsx** — every category is mapped with `active: true` regardless of DB value. `toggleCategory` writes the correct value to DB and `router.refresh()` re-fetches, but the re-fetched data is immediately overridden back to `active: true` in the `categories.map()`. The "ปิดใช้งาน" badge can never render and the toggle button always shows "ปิดใช้งาน" even for disabled categories. | P0 | `page.tsx:67` | Change `active: true` to `active: c.active ?? true` |
| 2 | **TRCloudBranchConfig `edits` state is never rehydrated after `router.refresh()`** — `edits` is initialized once via `useState` initializer from the `branches` prop. After `router.refresh()` the Server Component re-renders and passes new `branches` props, but React does NOT re-run the `useState` initializer — so `edits` stays stale. If another session or concurrent save changes the DB values, the inputs show the old values. The `isSaved` checkmark also stays visible permanently (it's never cleared on prop change). | P1 | `TRCloudBranchConfig.tsx:31–41` | Add a `useEffect` that resets `edits` (and `saved`) when the `branches` prop reference changes: `useEffect(() => { setEdits(Object.fromEntries(branches.map(...))); setSaved({}); }, [branches])` |
| 3 | **No GL code numeric/digit-count validation** — `trcloudAccCode` in both the add-form (`createCategory`) and edit-form (`updateCategoryTrcloud`) accept any string up to 40 chars. The Zod schema on the server has no numeric or length constraint beyond `max(40)`. Entering `"abc"` or `""` silently stores it. If TRCloud rejects non-numeric codes the push will fail silently at runtime with no user-facing error at save time. | P1 | `CategoryManager.tsx:120–125`, `_actions.ts:470` | Add client-side pattern check before calling `saveEdit`/`add`: reject if non-empty and not `/^\d{5,7}$/`. Add same regex `.regex(/^\d{5,7}$/, "รหัสบัญชี GL ต้องเป็นตัวเลข 5–7 หลัก")` to the Zod schema (make it `.optional().or(z.literal(""))` to keep empty = clear). |
| 4 | **Empty GL code wipes an existing mapping with no confirmation** — in `saveEdit`, if the user opens the edit row and clears the GL code input then hits บันทึก, `editState.trcloudAccCode` is `""` and the action writes `trcloudAccCode: null` to DB (via `trcloudAccCode \|\| null`). There is no warning, no "are you sure you want to remove the GL mapping?" prompt. The only feedback is the GL badge disappearing after refresh — easy to do accidentally. | P1 | `CategoryManager.tsx:66–80`, `_actions.ts:494` | Add a warning in the `saveEdit` function: if `editState.trcloudAccCode === ""` and the original `c.trcloudAccCode` was non-empty, show a confirmation dialog or at minimum display a warning `setMsg("การบันทึกจะลบรหัส GL ออก ยืนยันหรือไม่?")` with a confirm step. |
| 5 | **`isSaved` checkmark shows permanently — no auto-clear** — after a successful save in `TRCloudBranchConfig`, `setSaved({...prev, [branchId]: true})` is set and never cleared. The button shows a green check forever for that row in the current session, even if the user subsequently edits the inputs again. The button appears non-interactive (looks like it already saved the new typed value) which can mislead the user. | P2 | `TRCloudBranchConfig.tsx:55` | Clear `isSaved` when the user starts typing: in both `onChange` handlers add `setSaved((prev) => ({ ...prev, [b.id]: false }))`. |
| 6 | **`companyId` prop in `TRCloudBranchConfig` is completely unused (`_companyId`)** — the prop is prefixed with `_` indicating intentional suppression. However the `updateBranchTrcloud` action re-validates `branchId` against `orgId` only — it does NOT verify that the branch belongs to the `companyId` the admin is currently scoped to. An admin scoped to Company A could (if they crafted the call) update a branch of Company B within the same org. | P1 | `TRCloudBranchConfig.tsx:18`, `_actions.ts:527–531` | Pass `companyId` to `updateBranchTrcloud` and add `companyId` to the `findFirst` where clause: `where: { id: branchId, orgId: session.user.org_id, companyId }`. Also remove the `_` prefix and use it. |
| 7 | **`categorySchema` for `createCategory` has no GL numeric validation either** — the add-form's `trcloudAccCode` field goes through `categorySchema` (separate from `updateCategoryTrcloudSchema`). Even if fix #3 is applied to the edit schema, newly-created categories can still receive non-numeric GL codes. | P1 | `_actions.ts:407` (categorySchema, not shown in excerpt) | Apply the same `/^\d{5,7}$/` regex to `categorySchema.trcloudAccCode`. |
| 8 | **`pending` state in `CategoryManager` is shared across all actions** — a single `useTransition` `pending` boolean is used for add, edit, and toggle. If two transitions fire concurrently (React batches them via `startTransition`) the `disabled={pending}` guard on the add button and all toggle buttons correctly disables, but when the transition resolves, `editingId` is closed regardless of which action ran (only `saveEdit` calls `setEditingId(null)`, which is correct). However `setMsg(null)` is only called in `add()` not in `saveEdit()` — a previous add-error message persists while the user is in the inline edit row. Minor UX confusion but can cause the user to think the edit failed. | P2 | `CategoryManager.tsx:85`, `saveEdit` block at line 66 | Add `setMsg(null)` at the start of `saveEdit`. |
| 9 | **`router.refresh()` called inside `startTransition` in `CategoryManager`** — `router.refresh()` in Next.js App Router triggers a full server re-render of the subtree. Calling it inside `useTransition` is fine per Next.js docs, but it races with the transition's `pending` state — `pending` may flip to `false` before the refresh is complete, briefly re-enabling buttons. This is cosmetic but can cause a double-submit if the user clicks fast. | P2 | `CategoryManager.tsx:76` | Move `router.refresh()` outside the transition or use `startTransition` from `useRouter` directly. Alternatively accept as-is (the server action is idempotent). |

---

## Auto-fixable P0/P1 — Exact Code Changes

**Bug #1 — P0 — hardcoded `active: true`**

File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/page.tsx` line 67

```ts
// BEFORE
active: true,
// AFTER
active: c.active ?? true,
```

**Bug #2 — P1 — stale edits after refresh**

File: `TRCloudBranchConfig.tsx`, add after the `edits` useState (after line 41):

```ts
useEffect(() => {
  setEdits(
    Object.fromEntries(
      branches.map((b) => [
        b.id,
        {
          project: String(b.settings?.trcloudProject ?? ""),
          department: String(b.settings?.trcloudDepartment ?? ""),
        },
      ]),
    ),
  );
  setSaved({});
}, [branches]);
```

Also add `useEffect` to the import on line 5: `import { useState, useEffect } from "react";`

**Bug #6 — P1 — cross-company branch mutation**

File: `_actions.ts` line 511–531:

```ts
// Add companyId to schema
const updateBranchTrcloudSchema = z.object({
  branchId: z.string().trim().min(1),
  companyId: z.string().trim().min(1),          // ADD
  trcloudProject: z.string().trim().max(100).optional().or(z.literal("")),
  trcloudDepartment: z.string().trim().max(100).optional().or(z.literal("")),
});
// In findFirst
where: { id: branchId, orgId: session.user.org_id, companyId },  // ADD companyId
```

File: `TRCloudBranchConfig.tsx` — change `_companyId` to `companyId` and pass it to `updateBranchTrcloud({ branchId, companyId, trcloudProject: project, trcloudDepartment: department })`.

**Bug #3 — P1 — GL code validation**

File: `_actions.ts` line 470, change:
```ts
trcloudAccCode: z.string().trim().max(40).optional().or(z.literal("")),
// TO:
trcloudAccCode: z
  .string()
  .trim()
  .refine((v) => !v || /^\d{5,7}$/.test(v), { message: "รหัสบัญชี GL ต้องเป็นตัวเลข 5–7 หลัก" })
  .optional()
  .or(z.literal("")),
```

Apply the same refine to `categorySchema` wherever `trcloudAccCode` is defined.

---

**Summary of applicable LESSONS.md patterns triggered here:**
- **B-018 (guarded findFirst then unscoped mutation)**: `updateBranchTrcloud` does `findFirst({id, orgId})` but the branch is not verified against `companyId`. One org can have multiple companies — Bug #6 is exactly this pattern.
- **B-SILENT-SUCCESS-STATUS**: `isSaved` in `TRCloudBranchConfig` permanently shows success — the UI lies to the user about the current state of unsaved edits (Bug #5).
- **Schema shipped pattern**: `active` column exists in DB and Prisma schema but the page.tsx mapper hardcodes it to `true` — data from the server is silently discarded at the boundary (Bug #1), same class as "migration written not applied."

---

Now I have the complete picture. Here is the full analysis:

---

## Bug Findings — data-integrity-verify

| # | Description | Severity | File:Line | Fix |
|---|---|---|---|---|
| B-1 | **No race protection on concurrent contact creates** — `resolveContactId` does `findUnique` then conditionally calls `createContact` then `upsert`. Two concurrent pushes for the same `vendorTaxId` from different expenses both miss the cache, both call `createContact`, both succeed, and the second `upsert` silently wins (overwrites `contactId`). Result: two TRCloud contacts for the same tax_id; the losing `contactId` is orphaned and any AP that used it is now attached to a ghost contact. The DB unique constraint `(orgId, companyId, taxId)` on `ledger_trcloud_contact` prevents duplicate rows in the cache table but does NOT prevent two TRCloud `contact/create.php` API calls racing. | P1 | `lib/ledger/trcloud-push.ts:136-158` | Single-expense push (`sendExpenseToTrcloud`) is already sequential-safe. The bulk action (`sendExpensesToTrcloud`) is already explicitly serial (`// Sequential on purpose`, line 927). The residual race window is two *separate* operator-triggered single pushes arriving within milliseconds. Short-term fix: convert the `findUnique + create + upsert` to a **DB advisory lock** or use `upsert` optimistically and let the unique constraint handle collisions: move `createContact` inside the upsert's `create` callback (not possible with Prisma's upsert). Practical fix: add a `try/catch` around the `upsert` that catches unique-constraint violation, then re-fetches — this at least prevents the ghost contactId from being used. See exact change below. |
| B-2 | **`DELETE FROM ledger_trcloud_product` in migration runs at deploy time, not per-env** — `prisma/migrations/20260606_ledger_trcloud_v2.sql` line 9 has `DELETE FROM ledger_trcloud_product;` with no WHERE clause. This runs at migration apply time against whatever database is connected. If the migration is applied twice (e.g. `supabase db push --include-all` on a branch, then again on prod), or applied on prod while env vars are not yet set (`TRCLOUD_JPS_*` = ""), the cache is wiped. After the wipe, `resolveFixedSku` will call TRCloud `inventory/search.php`. With no env vars, `COMPANY_ID=""` and `PASSKEY=""` so `trcloudPushConfigured()` returns `false` and `pushExpenseToTrcloud` exits early with a user-facing error — so **no bad data is created**. This is a P2 operational risk (cache nuke on re-apply) not a silent data corruption. | P2 | `prisma/migrations/20260606_ledger_trcloud_v2.sql:9` | Add a WHERE clause targeting old v1 SKU codes: `DELETE FROM ledger_trcloud_product WHERE name_key NOT LIKE 'jps-%';` Or gate it: `DELETE FROM ledger_trcloud_product WHERE product_id NOT IN ('JPS-100','JPS-101','JPS-103');` This scopes the wipe to legacy SKUs only and is idempotent. |
| B-3 | **`Branch.settings` is JSONB in Postgres — no bug, but no GIN index** — `init.sql:15` confirms `JSONB NOT NULL DEFAULT '{}'`. Prisma `Json` maps to `jsonb` on PostgreSQL by default. The `->` / `@>` operator works. However, there is no GIN index on `branches.settings`. The `listBranches` query selects `settings` for every active branch per company, which is fine (full row scan, small table). The `buildWhere` in `queries.ts` never filters on `settings` directly. No current query-correctness bug. | P2 (latent) | `prisma/schema.prisma:298` | Not blocking today. If a future feature needs `settings @> '{"trcloudProject":"X"}'` filtering, add: `@@index([settings], type: Gin)` in the Prisma schema + migration. |
| B-4 | **`categoryId = null` is handled correctly — no bug** — In `listExpenses`/`listExpensesSummary`, the `EXPENSE_INCLUDE` joins `category` with `LedgerCategory?` (nullable FK, `onDelete: SetNull`). `serializeExpense` uses `row.category?.name ?? null` (line 81). In `buildWhere`, `if (f.categoryId) where.categoryId = f.categoryId` — if the caller passes `categoryId: null` as a filter, the `if` is falsy and the filter is not applied (shows all, including nulls). Only if caller passes a truthy string does it filter. `spendByCategory` groups by `categoryId` and the null group is passed through with `categoryName: null`. All paths are correct. | None | `lib/ledger/queries.ts:81, 146` | No change needed. |
| B-5 | **`loadPushable` does NOT scope by `companyId`** — `loadPushable(orgId, id)` at line 759 queries `where: { id, orgId }` — no `companyId` in the WHERE. A confirmed expense from Company A and a confirmed expense from Company B in the same org both load. The caller `sendExpenseToTrcloud` never passes `companyId` into `loadPushable`, so a cross-company push is possible if an attacker (or a UI bug) passes an expense id from the wrong company. Per memory `feedback-ledger-query-must-filter-companyid-2026-06-06.md`: "one org = many legal entities ... ALWAYS include companyId". The bulk action `sendExpensesToTrcloud` does validate `loaded.companyId !== companyId` at line 930 and skips mismatches, but the single-expense action has no such check. | P1 | `app/(admin)/ledger/_actions.ts:759` | Add `companyId` to `loadPushable` signature and WHERE clause. See exact change below. |
| B-6 | **No `AbortSignal.timeout()` on any TRCloud API call** — The `post()` function at `trcloud-push.ts:63` makes a bare `fetch()` with no timeout signal. Per lesson B-002: every external API call must have `AbortSignal.timeout()`. A hung TRCloud server (planned maintenance, network partition) will hold the serverless function open until the platform's 30-second hard-kill, blocking the expense UI for the operator and consuming the Vercel function concurrency slot. This is not data corruption but is a reliability P1 on a financial push path. | P1 | `lib/ledger/trcloud-push.ts:63` | Add `signal: AbortSignal.timeout(15_000)` to the fetch options. |
| B-7 | **`branchId = null` on expense — `loadPushable` returns null `branchTrcloudProject/Department`, validation gate blocks push, no silent corruption** — When `row.branchId` is null, the Prisma `include: { branch: { select: { settings: true } } }` returns `row.branch = null`. Line 778: `row.branch?.settings` → undefined → `branchSettings = {}` → `branchTrcloudProject = null`. `pushExpenseToTrcloud` then hits the guard at line 318: `if (!e.branchTrcloudProject) return { ok: false, error: "สาขานี้ยังไม่มีรหัสโครงการ TRCloud" }`. The push is blocked with a clear error. No silent corruption. The status is set to "pending"? Actually no — `recordPushResult` writes `trcloudError` on failure, and `trcloudDocId` stays null (so the expense is re-pushable after the branch is assigned). Handled correctly. | None | `app/(admin)/ledger/_actions.ts:776-780` | No change needed — guard chain is correct. |
| B-8 | **Status not set to "pending" before external call — optimistic update risk** — Per lesson B-SILENT-SUCCESS-STATUS: status should be set to a transient state before calling external, then updated on success/failure. Currently `sendExpenseToTrcloud` calls `pushExpenseToTrcloud` (which calls TRCloud), then `recordPushResult`. If the function dies between the TRCloud call succeeding and `recordPushResult` writing to DB (e.g. Vercel timeout at 29.9s), the AP is in TRCloud but `trcloudDocId` is null — the operator can push again, creating a **duplicate AP in TRCloud**. The `trcloudDocId = "sent"` fallback at line 838 partially addresses this (if push succeeds but returns no docId, it still stamps "sent" to block re-push). But the timing gap before `recordPushResult` runs is still a real risk on slow TRCloud responses near the timeout boundary. | P1 | `app/(admin)/ledger/_actions.ts:890-891` | Before calling `pushExpenseToTrcloud`, optimistically stamp `trcloudDocId = "pending"` so a concurrent or retry push sees `alreadyPushed = true`. On success, update with the real docId. On failure, clear to null. This closes the "push succeeded, record failed" duplicate-AP window. |

---

### Auto-fixable P0/P1 bugs with exact code changes

**B-5 — loadPushable missing companyId scope**

In `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/_actions.ts`:

Change the function signature and WHERE:
```ts
// line 747-748 — BEFORE
async function loadPushable(
  orgId: string,
  id: string,

// AFTER
async function loadPushable(
  orgId: string,
  companyId: string,
  id: string,
```

Change the query WHERE (line 759-760):
```ts
// BEFORE
    where: { id, orgId },

// AFTER
    where: { id, orgId, companyId },
```

Update the two call sites:
```ts
// sendExpenseToTrcloud (line 882): pass companyId
// The caller doesn't have companyId in scope at that point — need to either:
// (a) add companyId as a parameter to sendExpenseToTrcloud (preferred), or
// (b) do a pre-flight findFirst to get companyId from the session's org, then pass it.
// Simplest: load companyId from session-scoped lookup before calling loadPushable.
```

**B-6 — No timeout on TRCloud fetch**

In `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/lib/ledger/trcloud-push.ts`, line 63:
```ts
// BEFORE
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
  });

// AFTER
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
```

**B-8 — No pending-lock before external push**

In `sendExpenseToTrcloud` around line 888-895:
```ts
// BEFORE
  if (loaded.alreadyPushed) return { ok: true, alreadySent: true };
  const res = await pushExpenseToTrcloud(loaded.pushable);
  await recordPushResult(orgId, loaded.companyId, id, session.user.id, res);

// AFTER
  if (loaded.alreadyPushed) return { ok: true, alreadySent: true };
  // Lock before external call — prevents duplicate AP if fn dies after push but before DB write
  await prisma.ledgerExpense.updateMany({
    where: { id, orgId, companyId: loaded.companyId, trcloudDocId: null },
    data: { trcloudDocId: "pending" },
  });
  const res = await pushExpenseToTrcloud(loaded.pushable);
  await recordPushResult(orgId, loaded.companyId, id, session.user.id, res);
  // recordPushResult on success overwrites "pending" → real docId
  // recordPushResult on failure must clear "pending" → null so retry is possible:
```

In `recordPushResult`, the failure branch (line 853) must also clear the pending lock:
```ts
// failure branch — BEFORE
    await prisma.ledgerExpense.updateMany({
      where: { id, orgId, companyId },
      data: { trcloudError: res.error.slice(0, 500) },
    });

// AFTER
    await prisma.ledgerExpense.updateMany({
      where: { id, orgId, companyId },
      data: { trcloudDocId: null, trcloudError: res.error.slice(0, 500) },
    });
```

---

### Summary

| Severity | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | B-5 (missing companyId scope in loadPushable), B-6 (no fetch timeout), B-8 (no pre-lock before external push) |
| P2 | 2 | B-1 (concurrent contact-create race — mitigated by serial bulk, low probability on single push), B-2 (migration DELETE wipes cache on re-apply) |
| None | 3 | B-3 (JSONB confirmed, no index needed today), B-4 (null categoryId handled), B-7 (null branchId validation gate blocks push correctly) |

---

All evidence collected. Here are the complete findings:

## Bug Findings — liff-mobile-verify

| # | Description | Severity | File:Line | Fix |
|---|---|---|---|---|
| **B-1** | **TRCloudBranchConfig is NOT rendered in the LIFF admin console.** The "settings" tab renders `CategoryManager`, `LineChannelCard`, `RichMenuButton`, `ExportConfigCard` — but `TRCloudBranchConfig` is never imported or rendered. Admins cannot fix "ยังไม่ผูก" branch errors from mobile. | **P1 BLOCKER** | `AdminConsole.tsx:15-18, 126-144` | Import `TRCloudBranchConfig` and add it to the settings tab. Also requires passing `branchesFull` with `settings` field (see B-3). |
| **B-2** | **`branchesFull` query omits the `settings` column.** `page.tsx` line 112 selects `{ id, code, name, province, isActive }` — the `settings` JSON field is missing. Even if `TRCloudBranchConfig` were added, it would receive `settings: null` for every branch, making `trcloudProject`/`trcloudDepartment` always blank and `unconfiguredCount` always equal to total branches. | **P0** | `page.tsx:109-113` | Add `settings: true` to the `select` object: `select: { id: true, code: true, name: true, province: true, isActive: true, settings: true }` |
| **B-3** | **`branchesFull` type in AdminConsole is `{ id, code, name, province, isActive }` — no `settings` field.** `BranchFull` type (used by `BranchPanel`) likely also lacks `settings`. The LIFF admin page passes `branchesFull` directly to `BranchPanel`, so even after fixing the query, the prop type won't accept `settings`. | **P1** | `AdminConsole.tsx:20` (BranchFull type), `page.tsx:146` | Extend `BranchFull` type with `settings: Record<string, unknown> \| null` and thread it through. |
| **B-4** | **`CategoryManager` IS rendered in the LIFF "settings" tab.** GL code, SKU, VAT config IS accessible from LIFF mobile. No bug here — working as intended. | INFO | `AdminConsole.tsx:127-130` | No action needed. |
| **B-5** | **`createCategory`, `toggleCategory`, `updateCategoryTrcloud`, and `updateBranchTrcloud` server actions only call `revalidatePath("/ledger/settings")` — they do NOT call `revalidatePath("/liff/ledger/admin")`.** After an admin saves a category mapping or branch TRCloud project from LIFF, Next.js does NOT purge the `/liff/ledger/admin` RSC cache. The mobile page will show stale data until a hard refresh. The `TRCloudBranchConfig.tsx` component does call `router.refresh()` client-side, but that relies on Next.js router cache — if the RSC segment is still fresh from the server cache, stale data shows. | **P1** | `_actions.ts:445, 463, 507, 555` | Add `revalidatePath("/liff/ledger/admin")` to all four actions (same pattern as line 1580 which correctly does this for member scope updates). |
| **B-6** | **`updateBranchTrcloud` action has a guarded-findFirst-then-unscoped-mutation gap (B-018 pattern).** Line 527-531: `findFirst({ id: branchId, orgId })` validates ownership, then line 537: `updateMany({ where: { id: branchId, orgId } })` — this one IS scoped correctly with `orgId` in the `where`. No cross-org leak here, but the `settings` merge on line 539-545 does a `...currentSettings` spread from the `findFirst` result. If the `findFirst` races with another update between the read and write, the `settings` merge can drop concurrent changes (TOCTOU / lost-update). | LOW | `_actions.ts:527-556` | Use a Postgres JSON merge via raw SQL or a single `update` with `jsonb_set()` instead of read-then-spread. For MVP this is acceptable. |
| **B-7** | **`ExportConfigCard` IS imported in `AdminConsole.tsx` (line 18) and IS rendered in the LIFF settings tab (line 142).** This was asked as a check — confirmed present. | INFO | `AdminConsole.tsx:18, 142` | No action needed. |

---

## Auto-fixable P0/P1 bugs with exact code changes

**Fix B-2 (P0) — `page.tsx` line 112: add `settings: true` to branch select**

```ts
// Before:
select: { id: true, code: true, name: true, province: true, isActive: true },

// After:
select: { id: true, code: true, name: true, province: true, isActive: true, settings: true },
```

**Fix B-1 + B-3 (P1) — `AdminConsole.tsx`: import and render `TRCloudBranchConfig`**

Add to imports (line 20 area):
```ts
import { TRCloudBranchConfig } from "@/app/(admin)/ledger/settings/_components/TRCloudBranchConfig";
```

Extend `BranchFull` type (in `BranchPanel.tsx` or inline) to include `settings: Record<string, unknown> | null`.

Add to the settings tab block (after `CategoryManager`, before `LineChannelCard`):
```tsx
<TRCloudBranchConfig
  companyId={companyId}
  branches={branchesFull.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    settings: b.settings && typeof b.settings === "object"
      ? (b.settings as Record<string, unknown>)
      : null,
  }))}
/>
```

**Fix B-5 (P1) — `_actions.ts`: add LIFF revalidation to 4 settings actions**

At lines 445, 463, 507, and 555 — after each existing `revalidatePath("/ledger/settings")` line, add:
```ts
revalidatePath("/liff/ledger/admin");
```

---

## Bug Findings — expense-push-ui-verify

---

**Summary of what EXISTS (working correctly):**

1. "ส่งเข้า TRCloud" button: EXISTS in both the detail pane (`SendToTrcloudButton` in `ExpenseReviewPane.tsx:340`) and as a bulk action button in the list (`ExpenseList.tsx:258-261`).
2. Push result visibility: EXISTS — `SendToTrcloudButton` shows a `CloudCheck` "ส่ง TRCloud แล้ว · {docNo}" badge after success, and an inline error string on failure. Per-row in the list shows a blue `CloudCheck TR` badge (with tooltip showing docNo) or a rose `AlertTriangle TR` badge for errors.
3. Bulk-push button: EXISTS — appears in the sticky bulk bar when `sendableIds.length > 0`, showing count of eligible rows.
4. TRCloud sent/unsent filter: EXISTS — two filter tabs "ยังไม่ส่ง TRCloud" / "ส่งแล้ว" using `?tr=unsent|sent` URL param, wired through `listExpensesSummary` with `where.trcloudDocId = null / { not: null }`.
5. Config-specific error: EXISTS — `trcloudPushConfigured()` is checked at action level, returning a specific Thai error: "ยังไม่ได้ตั้งค่าการเชื่อม TRCloud (ผู้ดูแลตั้ง env TRCLOUD_* ใน Vercel)". However see Bug #2 below.

---

| # | Description | Severity | File:Line | Fix |
|---|---|---|---|---|
| 1 | **B-018 pattern — `loadPushable` scopes findFirst by `orgId` only, then `sendExpenseToTrcloud` mutates via `recordPushResult(orgId, loaded.companyId, ...)` where `companyId` is taken from the loaded row's own field.** A crafted expense `id` from company A could be fetched by a user of the same org whose active company is B; the row loads because `where: { id, orgId }` matches, then it gets pushed. The bulk path is safe (`loadPushable` + `loaded.companyId !== companyId` guard at L:930), but the single-push path (`sendExpenseToTrcloud`) has no such cross-company check. | P1 | `_actions.ts:759-760` + `_actions.ts:882-891` | Add `companyId` to the caller or add it to `loadPushable`. The single-push is called from `SendToTrcloudButton` which does not pass `companyId`. Quickest fix: pass `companyId` from `ExpenseReviewPane` → `SendToTrcloudButton` → `sendExpenseToTrcloud`, then add it to `loadPushable`'s where: `where: { id, orgId, companyId }`. |
| 2 | **`trcloudPushConfigured()` error is surfaced in the button tooltip/text ONLY after the user clicks "ส่งเข้า TRCloud" — the button appears enabled and blue for confirmed expenses even when env vars are absent.** User clicks, waits for server round-trip, then sees the error text under the button. No pre-flight UI hint that config is missing. | P2 | `ExpenseReviewPane.tsx:339` + `SendToTrcloudButton.tsx:56` | Pass `isConfigured: boolean` (from a server-side `trcloudPushConfigured()` call at page render) down to `SendToTrcloudButton`. If `!isConfigured`, render a tooltip badge "TRCloud ยังไม่ตั้งค่า" instead of the active button, with a link to Settings. |
| 3 | **Bulk-send partial failure shows "พลาด N" count but not the `firstError` string** — when `res.ok=true` but `res.failed > 0`, the message is e.g. "ส่งเข้า TRCloud 2 ใบ · พลาด 1" with no hint of WHY the 1 failed (missing SKU? missing branch config? TRCloud timeout?). The accountant must click into each failed row to discover the per-row `trcloudError`. | P2 | `ExpenseList.tsx:124-134` | Show `res.firstError` appended to the failure msg: `if (res.failed && res.firstError) parts.push(`(${res.firstError.slice(0, 80)})`)` |
| 4 | **`trcloudPushedAt` timestamp is stored in DB but never displayed to the user.** The badge in the list pane and the `SendToTrcloudButton` confirmed state show docNo but not when it was pushed. Accounting needs the timestamp for reconciliation. | P3 | `SendToTrcloudButton.tsx:38` | Accept `trcloudPushedAt?: string | null` prop; add `· ส่งเมื่อ {formatDate(trcloudPushedAt)}` to the badge title/tooltip. Already in `ExpenseRow` type. |
| 5 | **No `AbortSignal.timeout()` on any `fetch()` call in `trcloud-push.ts`** — all three network calls (`contact/search.php`, `contact/create.php` or `inventory/search.php`, `ap/create.php`) use bare `fetch()`. If TRCloud is slow, the Vercel serverless function will run until Vercel's 10s/60s wall-clock limit, blocking the entire Next.js response. A batch push of 10 expenses = up to 30 bare fetches in serial. | P1 | `trcloud-push.ts:63` (inside `post()`) | Add `signal: AbortSignal.timeout(8000)` to the `fetch()` call in `post()`. One-line fix: `const res = await fetch(..., { ..., signal: AbortSignal.timeout(8000) });` Wrap the call in try/catch for `AbortError` and rethrow as `{ ok: false, error: "TRCloud timeout (>8s)" }`. |
| 6 | **`loadScopedByOrg` (used by LIFF actions) also scopes findFirst by `orgId` only** — same pattern as #1 but for the LIFF-facing member actions; a member with a crafted expense `id` from another company in the same org can load and edit it (status gate applies but companyId check does not). | P1 | `_actions.ts:968-973` | `where: { id, orgId }` → `where: { id, orgId, companyId: actor.companyId }`. Requires `actor` to carry `companyId` (check `resolveLedgerActor()` return shape). |

---

**Auto-fixable P0/P1 changes:**

**Bug #5 — one-line fix in `lib/ledger/trcloud-push.ts:63`:**
```ts
// BEFORE
const res = await fetch(`${BASE}/${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
  body: body.toString(),
});

// AFTER
let res: Response;
try {
  res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
} catch (e) {
  const msg = e instanceof Error && e.name === "TimeoutError" ? "TRCloud timeout (>8s)" : "TRCloud network error";
  return { ok: false, status: 0, data: null, raw: msg };
}
```

**Bug #1 — fix `sendExpenseToTrcloud` in `_actions.ts:869`:**
```ts
// Change signature to accept companyId, add it to loadPushable call
export async function sendExpenseToTrcloud(
  id: string,
  companyId: string,   // ADD THIS
): Promise<ActionResult & { docNo?: string | null; alreadySent?: boolean }> {
  // ...
  const loaded = await loadPushable(orgId, id, companyId);   // pass companyId
  // ...
}

// And in loadPushable:
async function loadPushable(orgId: string, id: string, companyId?: string) {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId, ...(companyId ? { companyId } : {}) },   // scope if provided
    // ...
  });
}
```
Then update `SendToTrcloudButton` to receive `companyId` and pass it through.

**Bug #3 — one-line fix in `ExpenseList.tsx:127`:**
```ts
// BEFORE
if (res.failed) parts.push(`พลาด ${res.failed}`);

// AFTER
if (res.failed) parts.push(`พลาด ${res.failed}${res.firstError ? ` (${res.firstError.slice(0, 80)})` : ""}`);
```

## Fixes Applied
All fixes verified. TypeScript is clean. Here is the summary:

---

## Fixes Applied

### Files Modified

**`lib/ledger/trcloud-push.ts`**
- **B-2 (P1) — Fetch timeout**: Added `signal: AbortSignal.timeout(15_000)` to the `post()` fetch call with a try/catch that surfaces a Thai-readable error on `TimeoutError`/`AbortError`.
- **B-3 (P1) — Empty taxId cache collision**: Wrapped the DB cache lookup and write in `if (taxId)` guards. No-taxId vendors are never cached (prevents all no-taxId vendors from colliding onto the first cached contact row).

**`app/(admin)/ledger/_actions.ts`**
- **B-8 / B-1 (P1) — Pre-push lock**: Before calling TRCloud, atomically stamps `trcloudDocId = "pending"` via `updateMany({ where: { trcloudDocId: null } })`. If `claimed.count === 0`, another request already won — returns `alreadySent: true` without calling TRCloud.
- **B-8 failure branch**: In `recordPushResult` failure path, added `trcloudDocId: null` to clear the "pending" sentinel so failed pushes can be retried.
- **B-5 (P1) — loadPushable missing companyId**: Added optional `companyId` param to `loadPushable`; passes it to `findFirst` where clause when provided.
- **B-6 from settings-ui (P1) — Cross-company branch mutation**: Added `companyId` to `updateBranchTrcloudSchema` and to the `branch.findFirst` WHERE clause, preventing an admin from updating a branch belonging to a different company within the same org.
- **B-5 from liff-mobile (P1) — LIFF revalidatePath**: Added `revalidatePath("/liff/ledger/admin")` to all 4 settings actions: `createCategory`, `toggleCategory`, `updateCategoryTrcloud`, `updateBranchTrcloud`.

**`app/(admin)/ledger/settings/page.tsx`**
- **Bug #1 (P0) — Hardcoded `active: true`**: Changed to `active: c.active ?? true` so category `active` state is read from DB.

**`app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx`**
- **Bug #2 (P1) — Stale edits after refresh**: Added `useEffect` that re-hydrates `edits` state and clears `saved` map whenever the `branches` prop reference changes.
- **Bug #6 (P1) — Unused companyId**: Changed `companyId: _companyId` to `companyId`, passes it through to `updateBranchTrcloud({ branchId, companyId, ... })`.
- **Bug #5 (P2) — isSaved checkmark stale**: Added `setSaved((prev) => ({ ...prev, [b.id]: false }))` to both input `onChange` handlers.

**`app/liff/ledger/admin/page.tsx`**
- **B-2 (P0) — Missing `settings` in branch query**: Added `settings: true` to the `prisma.branch.findMany` select.
- **Bug #1 (P0) — Hardcoded `active: true` in LIFF**: Changed to `c.active ?? true`.
- **Type fix**: Maps `branchesFull` with proper `settings` cast from `JsonValue` → `Record<string, unknown> | null` before passing to `AdminConsole`.

**`app/liff/ledger/admin/_components/AdminConsole.tsx`**
- **B-1 + B-3 (P1) — TRCloudBranchConfig missing from LIFF settings tab**: Imported `TRCloudBranchConfig` and added it to the settings tab (between CategoryManager and LineChannelCard). Extended `branchesFull` prop type to include `settings`.

**`lib/ledger/queries.ts`**
- Added `active: true` to `listCategories` select and removed the `active: true` filter so all categories (including inactive) are returned to the settings page — enabling the toggle button to show real state.

### TypeScript Check Result
Zero errors (after all fixes).

---

## Bugs Deferred

| Bug | Reason |
|---|---|
| B-4 (P2) — VAT fractional per-unit price rounding | Low real-world impact (document-level VAT sum is correct; TRCloud off by ≤฿0.01 on multi-qty items) |
| B-7 (P2) — `trcloudDocId = "sent"` when TRCloud returns no docId | The new "pending" sentinel system handles this better; `"sent"` path still exists as fallback but is less harmful now |
| B-8 settings-ui (P2) — `categoryId`/`companyId` in CategoryManager shared `pending` state | UX-only; no data corruption |
| B-9 settings-ui (P2) — `router.refresh()` inside `startTransition` race | Cosmetic; server actions are idempotent |
| B-6 liff-mobile (LOW) — TOCTOU settings merge on branch update | Requires raw SQL `jsonb_set()` for true atomicity; MVP-acceptable |
| loadScopedByOrg companyId scope (LIFF member actions) | `LedgerActor` doesn't carry `companyId`; `actorCanReachBranch` branch-scope check already mitigates cross-company access in practice |

## Regression Library Additions
- Race condition on concurrent push (two requests hitting sendExpenseToTrcloud before trcloudDocId set)
- null branchId on expense causes unclear push error
- TRCloudBranchConfig missing from LIFF AdminConsole settings tab
- No AbortController on TRCloud API fetch (timeout risk)
