# UPSPEED · LedgerLine TRCloud · 2026-06-06

## Baseline
Next.js 15 App Router + Prisma + Supabase (transaction pooler 6543) + TRCloud API (pooil.trcloud.co). Vercel serverless (iad1). Push flow: 3 external API calls per expense (~1.5s/expense cold).

## Performance Findings
I now have all the information needed. Let me compile the full analysis.

---

## §findings

| # | Issue | Current cost | Fix | Expected gain |
|---|-------|-------------|-----|---------------|
| F-1 | **sendExpensesToTrcloud bulk loop — N loadPushable calls** | For a batch of N rows: N × `findFirst` (expense + items + category + branch JOIN). For 20 rows = 20 sequential DB round-trips before TRCloud calls even start. | Bulk-load all expense rows in one `findMany` with the same `include`; build a Map; iterate. | Saves N-1 DB queries; for a 20-row batch ~19 fewer round-trips = ~200-400 ms saved on cold start. |
| F-2 | **sendExpensesToTrcloud — recordPushResult also sequential** | Each iteration: 1 `updateMany` + 1 `audit` write = 2 more sequential writes per row. 20-row batch = 40 write queries after the 20 reads. | Batch writes can't be trivially fused (each must wait for TRCloud response), but the `loadPushable` pre-fetch can be separated so writes stay sequential while reads are batched. | Removes the N read cost; write cost is unavoidable due to TRCloud serial constraint. |
| F-3 | **LedgerTrcloudContact lookup — no explicit DB index on (orgId, companyId, taxId)** | `findUnique` uses the `@@unique([orgId, companyId, taxId])` constraint which Prisma maps to a unique index in Postgres — this IS indexed. **No problem here.** | No action needed. | — |
| F-4 | **LedgerTrcloudProduct lookup — nameKey unique constraint** | `findUnique` targets `@@unique([orgId, companyId, nameKey])` — also a unique index. **No problem here.** | No action needed. | — |
| F-5 | **exportConfirmedCsv — `take: 5000` with full `include: {items:true}`** | `listExpenses()` (not `listExpensesSummary`) with `take:5000` loads every line-item row for up to 5,000 expenses. A company with 500 expenses × 3 items avg = 1,500 item rows transferred to Node. CSV build only needs flat expense fields + items, which is fine, but it still streams all columns + all item columns including unused ones (attachments JSON etc). | Use `listExpensesSummary` if items aren't needed for CSV, OR add a dedicated CSV query `select`ing only the CSV-relevant columns from both tables. | Reduces payload ~30-50% depending on attachment JSON size; faster serialization. |
| F-6 | **listCategories — no pagination; unbounded for large orgs** | `findMany` with no `take` on `ledger_category` scoped by `(orgId, companyId)`. Pooilgroup current scale: small category set per company (< 30 likely), so this is low-risk today. But the function is called on 3 pages simultaneously (expenses, budgets, settings) — React `cache()` dedups within a single RSC render tree but NOT across navigations (it's per-request cache). | Add `take: 200` as a safety cap. Long-term: if categories grow, add server-side search. | Protects against future runaway but no measurable gain today. |
| F-7 | **loadPushable uses `findFirst` not `findUnique`** | `findFirst` on `(id, orgId, companyId?)` does a filtered seq scan even though `id` is a PK. Prisma emits `WHERE id=... AND org_id=...` — Postgres will use the PK index and filter; effectively a PK lookup. Minor but `findUnique({ where: { id } })` and then guard orgId in code would use the PK directly. | Replace with `findUnique` on `id` + JS-level orgId guard post-fetch. Low priority. | Negligible; Postgres PK lookup is already O(1). |
| F-8 | **LedgerExpense — no index on `trcloudDocId`** | `buildWhere` for `trcloudPushed: false` produces `WHERE trcloud_doc_id IS NULL`. With no index on `trcloud_doc_id`, Postgres must scan the whole `(orgId, companyId, status, docDate)` index result set and filter. As pushed rows accumulate this gets slower. | Add `@@index([orgId, companyId, trcloudDocId])` to `LedgerExpense`. | Partial index benefit when filtering unpushed rows from large tables. |
| F-9 | **resolveContactId — `upsert` on cache miss writes TRCloud result synchronously inside the push hot path** | Each new vendor: 1 `findUnique` miss + 1-2 TRCloud HTTP calls + 1 `upsert`. No issue with correctness, but the upsert runs inside the same awaited chain as the AP create. | No change needed — this is correct by design (cache-on-first-use). | — |

---

## §quick_wins

**QW-1: Batch-load expenses before the push loop** (~15 LOC change in `_actions.ts`)

In `sendExpensesToTrcloud`, replace the per-iteration `loadPushable(orgId, id)` call with a single pre-fetch:

```ts
// Before the for-loop:
const rows = await prisma.ledgerExpense.findMany({
  where: { id: { in: ids }, orgId, companyId },
  include: {
    items: { orderBy: { createdAt: "asc" } },
    category: { select: { name: true, trcloudAccCode: true, trcloudProductCode: true, vatClaimable: true } },
    branch: { select: { settings: true } },
  },
});
const expenseMap = new Map(rows.map(r => [r.id, r]));

// Inside the loop, replace:
//   const loaded = await loadPushable(orgId, id);
// with:
const row = expenseMap.get(id);
// then build `loaded` from row inline (same shape as loadPushable's return)
```

File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/_actions.ts`, lines 945-965.

Cost: ~15 LOC. No schema change. No migration. Safe.

---

**QW-2: Add `take: 200` safety cap to `listCategories`** (~2 LOC in `queries.ts`)

```ts
export const listCategories = cache(
  async (orgId: string, companyId: string) => {
    return prisma.ledgerCategory.findMany({
      where: { orgId, companyId },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      take: 200,   // <- add this
      select: { ... },
    });
  },
);
```

File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/lib/ledger/queries.ts`, line 339.

Cost: 1 LOC. No migration. Defensive only.

---

**QW-3: Add `trcloudDocId` index via migration** (~5 lines SQL)

```sql
-- Migration: add_trcloud_doc_id_index_ledger_expense
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "ledger_expense_org_company_trcloud_doc_id_idx"
  ON "ledger_expense" ("org_id", "company_id", "trcloud_doc_id");
```

Schema change in `schema.prisma` at line 5358 — add:
```
@@index([orgId, companyId, trcloudDocId])
```

Cost: ~5 LOC in migration + 1 LOC in schema. `CONCURRENTLY` = zero downtime. Required before the pushed-row count grows large.

---

**QW-4: Use `listExpensesSummary` in `exportConfirmedCsv`** (~3 LOC in `_actions.ts`)

At line 691, if the CSV builder in `trcloud-export.ts` doesn't use `items`, swap `listExpenses` to `listExpensesSummary` (already exported from queries.ts). Verify first by checking `buildTrcloudCsv`'s access of `expense.items`.

File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/_actions.ts`, line 691.

---

## §deferred

**D-1: True bulk AP push with parallelism (requires TRCloud dedup guarantee)**

The code comment at line 944 correctly explains why pushes are serial: two concurrent new-vendor creates would race into duplicate TRCloud contacts. The real fix is a per-vendor advisory lock (`SELECT pg_advisory_xact_lock(hashtext(taxId))`) before `resolveContactId`, then parallel `Promise.allSettled`. This is a significant refactor and requires confirming TRCloud's idempotency contract.

**D-2: Streaming CSV for `take: 5000`**

For periods with >1,000 confirmed expenses, building the full array in memory risks Vercel's 1024 MB Lambda limit. The correct fix is streaming — `prisma.$queryRawStream` or cursor pagination chunking — then pipe to a `ReadableStream` response. This requires changing the action's return type from `{ csv: string }` to a `Response` streaming object, which is a non-trivial API surface change.

**D-3: Push-status filter index (partial index)**

The `trcloudPushed: false` query path (`WHERE trcloud_doc_id IS NULL`) would benefit most from a partial index: `CREATE INDEX ... WHERE trcloud_doc_id IS NULL`. Prisma doesn't support partial indexes in `schema.prisma` natively — requires a raw SQL migration and `@@ignore` or a custom raw migration file. Deferred due to tooling friction.

---

## §findings (trcloud-push.ts)

| # | Issue | Current cost | Fix | Expected gain |
|---|---|---|---|---|
| F-01 | `revalidatePath("/ledger/settings")` is a no-op | `settings/page.tsx` carries `export const dynamic = "force-dynamic"` — Next.js skips all page-level caching for force-dynamic routes, so the 20+ `revalidatePath("/ledger/settings")` calls in `_actions.ts` purge a cache entry that does not exist. The calls are not harmful but they are dead code that misleads future maintainers. | No code fix needed for correctness. To eliminate confusion: remove the redundant `revalidatePath` calls for routes that are already force-dynamic, OR add a comment explaining the intent. Same applies to `/ledger/expenses`, `/ledger/dashboard`, `/ledger/budgets`. | 0ms runtime (pure dead code). Maintenance clarity only. |
| F-02 | `expenseByMonth` does a full-row `findMany` (application-side bucketing) instead of a DB `groupBy` | `_data.ts` line 129: fetches every `{ docDate, total }` row for the last 6 months, then buckets in JS. For a company with hundreds of expenses per month this reads 600–2,000+ rows just to produce 6 numbers. The `select` is tight (2 columns) so network payload is small, but DB query work + Prisma serialization loop is wasteful. | Replace `findMany` + JS bucketing with a single `groupBy({ by: ["docDate"], _sum:{total:true} })` filtered to the same date range. Collapse to YYYY-MM bucket in JS from the 6-month window (still a small loop but only over grouped results). Alternatively use a raw SQL `date_trunc('month', doc_date)` groupBy. | ~20–60ms saved on dashboards with >200 confirmed expenses; scales linearly with data volume. |
| F-03 | `EXPENSE_SUMMARY_SELECT` sends ~28 columns; the list UI reads ~12 | `queries.ts` lines 192–235: the summary select was created to skip `items` join (good) but still fetches `ocrModel`, `ocrConfidence`, `sha256`, `exportBatchId`, `claimantName`, `wht`, `subtotal`, `vat`, `bankDetail` (null), `vendorAddress` (null), `vendorBranchCode` (null), `isRecurring`, `paymentMethod`, `docType`, `discount`, `paymentStatus`, `driveWebUrl`, `originalUrl`, `thumbUrl`, `trcloudPushedAt`, `confirmedBy`, `confirmedAt`, `createdBy`, `updatedAt`, `source`, `vendorTaxId`. The list UI (`ExpenseList.tsx`) actually renders: `id`, `docCode`, `status`, `vendor`, `docDate`, `total`, `categoryName`, `trcloudDocId`, `trcloudDocNo`, `trcloudError`, `needsReview`, `branchId`. Extra columns are fetched, serialized by Prisma, and shipped in RSC payload for nothing. | Create a `EXPENSE_LIST_SELECT` (12 columns) used only by `listExpensesSummary`. Keep the existing wider select for the detail pane (`getExpense`) and export path that legitimately uses more fields. | ~15–30ms saved per page load for the expenses page (300-row fetch × column width). RSC payload reduction ~30%. |
| F-04 | 11 `router.refresh()` calls on every mutation — full-page RSC re-render | `CategoryManager.tsx` (3×), `TRCloudBranchConfig.tsx` (1×), `ExpenseList.tsx` (2×), `UploadReceiptButton.tsx` (1×), `BudgetForm.tsx` (1×), `BudgetRowActions.tsx` (1×), `ExpenseList` bulk confirm (1×). Each `router.refresh()` triggers a full server-side re-render of the page including all DB queries (even force-dynamic pages pay the re-render cost). The settings page re-fetches 6 data sources on every category toggle. | For `CategoryManager` (toggle active/inactive): use `useOptimistic` to flip the local `active` boolean immediately, call the server action, skip `router.refresh()`. For `BudgetRowActions` (delete): remove row from local state optimistically. These are the 5 highest-frequency cases. `UploadReceiptButton` and bulk-confirm legitimately need a list refresh — leave those. | 0.3–0.8s perceived latency eliminated on the most-used interactions (category edit, budget delete). On settings page each `router.refresh()` re-runs all 6 parallel queries (~150–300ms round-trip each time). |
| F-05 | `listInvites`, `listLedgerMembers`, `listLedgerGroups` are not `cache()`-wrapped — they run on every call | `_data.ts` lines 262, 297, 346: the comment says "not cached — the list changes". But they are called exactly once per page render (in `settings/page.tsx`'s `Promise.all`). The missing `cache()` is harmless now but means if any sub-component ever calls these directly the queries double. Low risk, easy to fix. | Wrap all three in `cache()`. The force-dynamic flag already ensures freshness on next navigation; `cache()` only dedupes within the same render pass. | Defensive: 0ms today, prevents future duplication bugs. |
| F-06 | `resolveScope` calls `listBranches` sequentially after `listCompanies` | `_scope.ts` line 32: `const branches = companyId ? await listBranches(...) : []` — this is a serial await. Since `listCompanies` and `listBranches` are independent queries, it adds one extra DB round-trip latency (~10–30ms) on every page load in the ledger module. (Both ARE `cache()`-wrapped so the queries themselves are deduplicated within a render, but the serial await in `resolveScope` means the page waits for companies before even starting branches.) | `resolveScope` can't run them in parallel because it needs `companyId` from companies to pick the right branches — the serial dependency is real. However, the caller already knows `orgId` and likely the `companyId` from the URL. Fix: pass an explicit `companyId` hint to `resolveScope` so it can skip the companies fetch when the param is already known. | ~10–25ms on pages where `?company=` param is present (most navigations after first visit). |
| F-07 | LIFF sub-routes `/liff/ledger/admin`, `/liff/ledger/expense/[id]`, `/liff/ledger/join` have no `loading.tsx` | Only `/liff/ledger/loading.tsx` exists. The three sub-routes render blank until their server component resolves (typically 300–800ms on mobile LINE WebView). The admin console and expense edit pane are the most latency-sensitive flows (staff use them in the field on slow connections). | Add `loading.tsx` skeletons for `/liff/ledger/admin/`, `/liff/ledger/expense/[id]/`, and `/liff/ledger/join/`. These are LIFF pages — a simple centered spinner or brand-color pulse is sufficient (full skeleton not required). | Eliminates blank-screen flash (0.3–0.8s perceived). Critical on mobile. |

---

## §quick_wins (queries + data layer)

All safe to implement independently, no schema changes, no API contract changes.

**QW-1 — LIFF sub-route loading skeletons** (F-07)
3 files, ~10 LOC each. Add `loading.tsx` to `/app/liff/ledger/admin/`, `/app/liff/ledger/expense/[id]/`, `/app/liff/ledger/join/`. A minimal pulse card is enough — the LIFF viewport is mobile-only:

```tsx
// /app/liff/ledger/admin/loading.tsx  (~8 LOC)
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col gap-3 p-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}
```

Repeat pattern for `expense/[id]/loading.tsx` and `join/loading.tsx`. Cost: ~30 LOC total. Time: <10 min.

**QW-2 — `useOptimistic` for CategoryManager toggle** (F-04, partial)
`settings/_components/CategoryManager.tsx` lines 110–115 — `toggle()` currently calls server action then `router.refresh()`. Replace with optimistic local flip:

```ts
// replace the toggle function (4 lines saved, instant UX)
const [optimisticCats, addOptimistic] = useOptimistic(categories, (prev, {id, active}) =>
  prev.map(c => c.id === id ? {...c, active} : c));

function toggle(id: string, active: boolean) {
  startTransition(async () => {
    addOptimistic({ id, active });
    await toggleCategory(id, active);
    // no router.refresh() needed — server action already called revalidatePath
  });
}
```

Drop the `router.refresh()` call. The `revalidatePath` in the action will refresh on next navigation. Time: ~15 min.

**QW-3 — Remove dead `revalidatePath` calls on force-dynamic routes** (F-01)
`_actions.ts`: 56 `revalidatePath` calls. The ones targeting `/ledger/settings`, `/ledger/expenses`, `/ledger/dashboard`, `/ledger/budgets` are all no-ops (all force-dynamic). The calls targeting `/liff/ledger/admin` may have effect if that LIFF route ever becomes ISR. Add a comment block at the top of `_actions.ts` explaining the pattern, then remove the `/ledger/*` calls that target force-dynamic routes. This removes ~40 dead calls. Time: ~10 min. Risk: zero.

**QW-4 — Wrap `listInvites`, `listLedgerMembers`, `listLedgerGroups` in `cache()`** (F-05)
`_data.ts` lines 262, 297, 346 — add `import { cache } from "react"` (already imported) and wrap:

```ts
export const listInvites = cache(async (orgId: string, companyId: string) => { ... });
export const listLedgerMembers = cache(async (orgId: string, companyId: string) => { ... });
export const listLedgerGroups = cache(async (orgId: string, companyId: string) => { ... });
```

Drop the `async` keyword in the comment (`Not cached — the list changes` — update comment to note it's deduplicated per-render, not cross-request). Time: <5 min.

---

## §deferred (queries + data layer)

**D-1 — `expenseByMonth` row-scan → DB `groupBy`** (F-02)
Requires rewriting `expenseByMonth` in `_data.ts` to use Prisma's `groupBy` with a month-truncated field. Prisma does not support `date_trunc` natively — needs a `$queryRaw` or a computed column approach. Not a one-liner; worth doing when the ledger is at scale (>500 expenses/month) but low-risk to defer until then. The function is already `cache()`-wrapped so it costs one round-trip per dashboard load, not per component.

**D-2 — Narrow `EXPENSE_SUMMARY_SELECT` to a true list-only projection** (F-03)
Requires creating a separate `EXPENSE_LIST_SELECT` constant and a matching `ExpenseListRow` type (subset of `Expense`). The challenge is that `listExpensesSummary` currently returns `Expense[]` (same type as the full detail query) — changing the return type to a narrower type would require updating `ExpenseList.tsx`, `BulkConfirm`, and the home page drafts panel. Safe refactor but touches 4+ files and requires type coordination. Worth doing in a dedicated "query slim-down" pass.

**D-3 — `resolveScope` parallel-hint optimization** (F-06)
The serial `listCompanies → listBranches` chain is structurally correct (needs companyId to pick branches). The real fix is making callers pass `company` param explicitly so `resolveScope` can issue both queries in parallel when the param is known. This requires adding an optional `knownCompanyId` to the function signature and threading it through all 5 call sites. Medium effort, ~10–25ms gain per navigation — worthwhile but not urgent.

**D-4 — `router.refresh()` elimination on bulk-confirm and upload** (F-04, remainder)
`UploadReceiptButton` and `ExpenseList` bulk-confirm use `router.refresh()` legitimately (new rows must appear). Replacing them with optimistic list insertion requires the server action to return the created/updated rows and the component to manage a local list merged with server state. This is a larger state management change (the expense list is currently fully server-owned via RSC). Evaluate when the list grows to >100 items and the re-render latency becomes noticeable.

---

## §findings (external API + push client)

| # | Issue | Current cost | Fix | Expected gain |
|---|-------|-------------|-----|---------------|
| F-01 | **`post()` has no timeout guard** | Already fixed — `AbortSignal.timeout(15_000)` is present on line 69 | N/A — already done | N/A |
| F-02 | **`authFields()` called once per `post()` call, not once per bulk push** | For a 50-expense push: each expense calls `post()` 2–3× = 100–150 MD5 hash + `Date.now()` calls. MD5 in Node is ~0.01 ms each — negligible CPU, but each call gets a different timestamp. TRCloud validates `timestamp` within ±300s so this is safe; it just means no shared timestamp across a bulk batch | Cache the auth fields for the duration of a push batch (single timestamp, single hash) | ~0 wall-clock, but slightly cleaner; low priority |
| F-03 | **`searchContactByTaxId` = 1 external round-trip per unique new vendor** | Cold miss: `resolveContactId` → `searchContactByTaxId` (1× `post`) → optionally `createContact` (1× `post`) = up to 2× external calls for an unknown vendor. Cache is DB-backed so a warm hit = 1× Prisma `findUnique` (~5 ms) | Pre-warm contact cache before a bulk push by querying all known `vendorTaxId` in the batch in a single `prisma.ledgerTrcloudContact.findMany({ where: { taxId: { in: taxIds } } })` | On a 50-expense push with 20 unique vendors all already cached: eliminates 20 individual `findUnique` round-trips → saves ~100 ms |
| F-04 | **`resolveFixedSku` cold-miss hits TRCloud on first request after deploy** | 3 fixed SKUs (JPS-100/101/103). On cold DB (fresh deploy or `ledgerTrcloudProduct` table wiped): each unique SKU code triggers 1× `post("inventory/search.php")`. 3 unique SKUs × 1 call × ~500 ms = ~1.5 s blocking time on the very first push. After warm-up all subsequent pushes hit the DB cache and skip the TRCloud call entirely | Add a startup pre-warm routine: on app boot (or first push), call `resolveFixedSku` for all 3 known SKUs in parallel. Since they never change, cache is permanent | Turns first-push from ~1.5 s extra → ~0 extra. Saves ~500 ms per newly-deployed instance per SKU code |
| F-05 | **Serial execution of contact + SKU resolution per expense in a bulk push** | `pushExpenseToTrcloud` is called once per expense. If the caller (bulk push action) runs them in a `for` loop sequentially, each expense blocks on its predecessor. 50 expenses × (1 Prisma contact lookup [~5 ms] + 1 Prisma SKU lookup [~5 ms] + 1 TRCloud `ap/create.php` [~500 ms]) = **~25 s wall-clock** minimum, assuming all contacts/SKUs are warm | Run pushes in parallel batches of 5–10 using `Promise.allSettled` in the caller. The TRCloud `ap/create.php` is the dominant cost; parallelizing 10 at a time would turn 50×500 ms = 25 s → ~2.5 s | **10× speedup on bulk push** |
| F-06 | **No-taxId vendors are never cached** | Intentional correctness choice (comment on line 153 explains why: `""` would be a collision key). But this means a push with 10 "เจ้าหนี้เบ็ดเตล็ด" lines calls `createContact` 10 times, creating 10 duplicate contacts in TRCloud | Cache no-taxId vendors by normalized name key (`normalizeKey(vendor)`), falling back to a single well-known "เจ้าหนี้เบ็ดเตล็ด" contact ID stored once | Stops TRCloud contact explosion for no-taxId vendors; saves 1× `createContact` call per repeated unnamed vendor |
| F-07 | **`authFields()` re-computes timestamp on every call — no request-level cache** | Per push: `post()` is called up to 3× (contact search, inventory search, ap/create). Each generates a fresh timestamp. Not a bug (TRCloud accepts any recent timestamp) but wastes 3 MD5 operations when 1 would do | Compute once at top of `pushExpenseToTrcloud` and pass `auth` down to `post()` as an argument | Negligible CPU; micro-optimization only |

---

## §quick_wins (external API + push client)

**QW-1 — Pre-warm SKU cache on first push (< 15 LOC, < 20 min)**

The 3 fixed SKUs never change. On cold start, warm all three in parallel before the first `ap/create.php` call. Add this near the top of `pushExpenseToTrcloud`:

```ts
// Pre-warm the 3 fixed SKUs in parallel (no-op if already cached)
const FIXED_SKUS = ["JPS-100", "JPS-101", "JPS-103"];
await Promise.all(FIXED_SKUS.map(code => resolveFixedSku(scope, code)));
```

Cost: 3 parallel Prisma reads (~5 ms each). On warm cache = effectively free. On cold cache = 3 parallel TRCloud calls (~500 ms each, but concurrent) = ~500 ms one-time penalty instead of paying it serially per push. **Saves ~1.5 s on first post-deploy push.**

File: `/lib/ledger/trcloud-push.ts`, insert after the validation gate block (after line 343), before step 1.

---

**QW-2 — Batch contact cache lookup before a bulk push (< 20 LOC, caller-side)**

In whatever Server Action calls `pushExpenseToTrcloud` in a loop, add a pre-flight cache warm:

```ts
// Pre-load contact cache for all unique taxIds in this batch
const taxIds = [...new Set(expenses.map(e => digitsOnly(e.vendorTaxId)).filter(Boolean))];
if (taxIds.length) {
  await prisma.ledgerTrcloudContact.findMany({
    where: { orgId, companyId, taxId: { in: taxIds } },
  });
  // Prisma will have these rows hot in connection pool; individual findUnique calls hit ~0 ms
}
```

This is a read-ahead hint pattern — the individual `resolveContactId` calls still issue their own `findUnique`, but the DB connection pool now has the pages cached. More robustly, build a `Map<taxId, ContactRef>` from the pre-fetch and pass it into a modified `resolveContactId` signature.

**Saves ~5 ms × N unique vendors = ~100 ms on a 20-vendor batch.**

---

**QW-3 — Parallelize bulk push in caller (caller-side, < 10 LOC)**

Wherever the bulk-push loop lives (the Server Action), replace serial `for...of` with batched parallel:

```ts
const CONCURRENCY = 8;
for (let i = 0; i < expenses.length; i += CONCURRENCY) {
  const batch = expenses.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map(e => pushExpenseToTrcloud(e)));
  // collect results...
}
```

**Expected gain: 50-expense push drops from ~25 s to ~3–4 s wall-clock.**

---

## §deferred (external API + push client)

**D-1 — No-taxId vendor deduplication (requires schema + UX decision)**

Caching "เจ้าหนี้เบ็ดเตล็ด"-style vendors by normalized name requires a new unique index on `(orgId, companyId, nameKey)` in `ledgerTrcloudContact` (currently only `taxId` is the unique key). Needs a DB migration and a decision on whether two expenses with vendor name "ร้านค้าทั่วไป" should resolve to the same TRCloud contact or be separate. Requires CEO decision before build.

**D-2 — Shared auth token / session reuse across a bulk push**

TRCloud uses timestamp+MD5 auth, not a session token, so there is nothing to reuse at the HTTP level. However if TRCloud ever introduces rate-limiting per `securekey`-interval, batching all calls in one second window (same timestamp, same `securekey`) could help. For now, each call is independently authenticated which is correct and safe.

**D-3 — TRCloud contact search returns `limit: 20` — silent miss risk**

If a company has >20 contacts matching the `keyword` (tax ID search), the desired contact might not be in the result window, causing a duplicate `createContact` to be issued. Fix: search by exact `tax_id` field if TRCloud supports it, or increase `limit` to `"100"`. Requires testing against the live TRCloud API to confirm field-level search support. Low probability issue in practice but real correctness risk for large contact books.

**D-4 — Retry / idempotency on `ap/create.php` failure mid-bulk-push**

Currently if `ap/create.php` fails for expense #23 of 50, the expense is marked failed but the caller must re-push it manually. TRCloud does not appear to expose an idempotency key. A proper at-least-once delivery system (store `trcloudDocId` back on `ledger_expense`, skip re-push if already set) is partially implied by the schema but the retry UX is not implemented. Needs dedicated sprint.

---

**50-expense bulk push wall-clock estimate (current vs fixed):**

| Scenario | Wall-clock |
|----------|-----------|
| Current (serial, all contacts warm, SKUs warm) | 50 × 500 ms = **~25 s** |
| After QW-3 only (parallel ×8, contacts warm) | ceil(50/8) × 500 ms = **~3.5 s** |
| After QW-1 + QW-3 (parallel, SKU pre-warm on cold) | ~500 ms pre-warm + ~3.5 s push = **~4 s total** |
| Cold contacts (all 50 vendors unknown) + serial | 50 × (500+500+500) ms = **~75 s** |
| Cold contacts + QW-3 parallel ×8 | ~11 s |

---

## §findings (settings page + components)

| # | Issue | Current cost (perceived latency) | Fix | Expected gain |
|---|---|---|---|---|
| F-1 | **TRCloudBranchConfig: `router.refresh()` after every branch save** | 300–800 ms full RSC re-render + network round-trip after the action already returned `ok`. The user already sees the check-mark; the refresh adds a stall before inputs re-hydrate. | Remove `router.refresh()` from the success path. The `edits` state already holds the correct value (it was typed by the user). The progress bar and configured-count badge can be updated optimistically from local state. The `useEffect([branches])` re-hydrate is only needed for the refresh, which we're eliminating. | Save feels instant. No blank re-render between check-mark and next edit. |
| F-2 | **CategoryManager: `router.refresh()` on every mutation (saveEdit, add, toggle)** | Same 300–800 ms RSC stall. Three separate paths all call `router.refresh()` unconditionally on success. The `editingId` is already cleared before the refresh fires, so the panel collapses visually first — but the list stays stale-looking until refresh completes. | Use `useOptimistic` or local `cats` state clone. On success, patch the local list; on error, revert. Call `router.refresh()` only on `toggle` (active/inactive affects other pages) or skip it entirely since `revalidatePath` in the Server Action already invalidates the cache. | Each inline save (GL + SKU + VAT) resolves in < 50 ms perceived. |
| F-3 | **Settings page: all 6 queries in one sequential `Promise.all` before first byte** | 6 parallel DB queries must ALL complete before the RSC sends HTML. On Supabase free-tier (Singapore), a cold connection adds 80–200 ms each. The slowest query (likely `listLedgerMembers` which does 2 round-trips: members → branch names) gates the entire page. | Wrap slow sections in `<Suspense>` with streaming. Fast path: render `CategoryManager` + `TRCloudBranchConfig` first (categories + branches are smallest). Suspend `MemberManager`, `InviteManager`, `GroupBranchManager` separately. | First visible content 400–900 ms earlier on cold load. |
| F-4 | **Loading skeleton does not cover TRCloudBranchConfig (31-branch list)** | The `loading.tsx` skeleton only fakes CategoryManager + 2 generic cards. When navigation hits `/ledger/settings`, the TRCloudBranchConfig section either: (a) pops in after the skeleton disappears causing layout shift, or (b) is missing from the skeleton causing a jarring height jump on 31-row render. | Add a branch-list skeleton block to `loading.tsx` (or to a dedicated `<Suspense fallback>` if split per F-3). Match height: 31 rows × ~52 px = ~1600 px. A simple `<Skeleton className="h-96 w-full rounded-xl" />` placeholder is enough to prevent CLS. | Eliminates layout shift on the largest element on the page. |
| F-5 | **`updateBranchTrcloud` action does a sequential `findFirst` + `updateMany` + `audit()` write** | 3 serial DB round-trips per save. On a 30 ms Supabase RTT, that is ~90 ms server-side just in queries before the response is returned. The audit write is fire-and-forget-safe. | Parallelise: `Promise.all([prisma.branch.updateMany(...)], [audit(...)])` — ownership is already guarded by `orgId` in the WHERE clause of `updateMany`, making the `findFirst` redundant. Remove the `findFirst`. | Save action server time drops ~60 ms. |
| F-6 | **`createCategory` does sequential `aggregate` (max sort) then `create`** | 2 serial DB round-trips. The `_max.sort` aggregate can be inlined with a DB-level `SELECT MAX` or eliminated by using `createdAt` ordering and appending via a large fixed sort offset. | Use a single `INSERT ... SELECT COALESCE(MAX(sort),0)+1 FROM ...` via raw query, or simply set `sort: Date.now()` (millisecond epoch guarantees monotonic order without a pre-read). | One fewer round-trip per category add (~30 ms server-side). |
| F-7 | **`useTransition` in CategoryManager locks ALL buttons during any pending op** | `const [pending, startTransition] = useTransition()` — a single boolean `pending` from `useTransition` disables every Pencil/toggle/add button while any one transition runs. If toggle fires while add is pending, every button on the page goes `disabled`. | Use per-item `pending` maps (same pattern TRCloudBranchConfig already uses correctly) or separate `useTransition` instances per action type. | UX correctness fix: users can edit categories concurrently. |

---

## §quick_wins (settings page + components)

Each of these is safe, additive, and under 20 LOC.

**QW-1: Remove `router.refresh()` from TRCloudBranchConfig save success path** — 3 lines deleted in `/app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx`.

The `edits` state already reflects the user's typed values. The progress bar / configured-count can be derived from `edits` instead of `branches.settings`. The `useEffect([branches])` re-hydration guard becomes a no-op and can also be removed (5 more lines gone).

```tsx
// DELETE these lines inside save():
router.refresh();   // line 80

// DELETE the entire useEffect([branches]) block — lines 50-62
// The edits initializer in useState already seeds from branches on mount;
// without refresh() there is no stale-prop scenario to guard against.
```

Estimated effort: 5 min. Risk: none — local state is the source of truth.

**QW-2: Add TRCloudBranchConfig skeleton block to `loading.tsx`** — 8 lines added.

```tsx
{/* TRCloud branch config (full width) — 31 rows approximated */}
<div className="rounded-2xl border border-zinc-200 bg-white p-4 lg:col-span-2">
  <Skeleton className="mb-3 h-4 w-40" />
  <Skeleton className="mb-3 h-8 w-full rounded-lg" />
  {Array.from({ length: 5 }, (_, i) => (
    <div key={i} className="flex items-center gap-3 py-3 border-t border-zinc-100">
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-8 w-24 rounded-lg" />
      <Skeleton className="h-8 w-24 rounded-lg" />
      <Skeleton className="h-8 w-14 rounded-lg" />
    </div>
  ))}
</div>
```

Estimated effort: 5 min. Fixes the CLS completely.

**QW-3: Parallelise the `audit()` write in `updateBranchTrcloud`** — replace 2 sequential awaits with `Promise.all`. Remove the `findFirst` ownership check (the `updateMany` WHERE `orgId` clause is an equivalent guard):

```ts
// REMOVE the findFirst block (lines 531-535)
// REPLACE sequential awaits with:
await Promise.all([
  prisma.branch.updateMany({ where: { id: branchId, orgId: session.user.org_id }, data: { settings: { ...currentSettings, trcloudProject: trcloudProject || null, trcloudDepartment: trcloudDepartment || null } } }),
  audit({ orgId: session.user.org_id, userId: session.user.id, action: "LEDGER_BRANCH_UPDATED", resourceType: "branch", resourceId: branchId, diff: { new: { trcloudProject: trcloudProject || null, trcloudDepartment: trcloudDepartment || null } } }),
]);
```

One caveat: the `findFirst` also reads `branch.settings` to merge (spread `currentSettings`). Without it, you lose the JSON merge — you'd need to handle that differently (raw upsert of individual JSON keys via Prisma `$queryRaw`, or accept that `updateBranchTrcloud` owns the full `settings` object). Keep `findFirst` if other keys in `settings` must be preserved. If `trcloudProject/Department` are the only known keys today, you can drop the spread and just write `{ trcloudProject, trcloudDepartment }` directly.

Estimated effort: 10 min.

**QW-4: Per-item pending in CategoryManager for the toggle button** — replace the shared `useTransition` for `toggle` with a `Record<string, boolean>` map, identical to TRCloudBranchConfig's pattern:

```tsx
const [togglePending, setTogglePending] = useState<Record<string, boolean>>({});

function toggle(id: string, active: boolean) {
  setTogglePending(prev => ({ ...prev, [id]: true }));
  startTransition(async () => {
    await toggleCategory(id, active);
    setTogglePending(prev => ({ ...prev, [id]: false }));
    router.refresh();
  });
}
// In JSX: disabled={!!togglePending[c.id]} instead of disabled={pending}
```

This unblocks all other buttons while a single toggle is in flight. Estimated effort: 10 min.

---

## §deferred (settings page + components)

**D-1: Streaming the settings page with per-section `<Suspense>`** — requires extracting each card into its own async Server Component so data can be fetched independently. This is a moderate refactor (M) because the current `page.tsx` passes multiple props from a single `Promise.all` down to client components. To stream, each section needs its own data-fetch wrapper. The `branches` prop is shared between `TRCloudBranchConfig`, `LineChannelCard`, `GroupBranchManager`, `InviteManager` and `MemberManager` — splitting the fetch without re-querying branches 5 times requires either a shared cache key or a context provider. Complexity: M. Gain: 400–900 ms earlier first-paint on cold load.

**D-2: Optimistic category list for `createCategory` and `saveEdit`** — to eliminate `router.refresh()` entirely from CategoryManager, the component needs to maintain a local copy of `categories` in state and patch it on success. This requires lifting the `Cat[]` into `useState`, updating on add/edit/toggle, and reverting on error. Complexity: M (20–50 LOC, needs careful revert logic). Gain: each mutation resolves in < 50 ms perceived instead of 300–800 ms.

**D-3: `listLedgerMembers` 2-query pattern** — the function fetches all member rows, collects branch IDs, then fires a second `findMany` for branch names. This is correct and not N+1, but it still incurs 2 serial round-trips. A single Prisma `include: { branch: ... }` on the member model (if the FK relation exists) would collapse it to 1 query. Requires checking the Prisma schema for the relation. Complexity: S if relation exists, M if it must be added. Gain: ~30 ms server-side on the settings page load.

---

## Quick Wins Applied
Clean — zero TypeScript errors.

**Changes applied:**

**1. `post()` AbortController timeout** — already present (`AbortSignal.timeout(15_000)` on line 69 of `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/lib/ledger/trcloud-push.ts`). No change needed.

**2. `/ledger/settings/loading.tsx` — TRCloudBranchConfig skeleton added**
File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/loading.tsx`
Inserted a full-width skeleton block (search bar + 5 branch rows) between the CategoryManager block and the LINE channel cards. Prevents the CLS/layout-jump when the 31-branch list renders after the skeleton disappears.

**3. `listInvites`, `listLedgerMembers`, `listLedgerGroups` wrapped in `cache()`**
File: `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/_data.ts`
All three plain `async function` exports converted to `cache(async function ...)`. This deduplicates any concurrent calls to these functions within a single RSC render pass (prevents future double-fetch if sub-components ever call them directly). Updated JSDoc comments to explain the cache-vs-force-dynamic relationship.

**TS check: 0 errors.**

---

## Slow-Pattern Library Additions
- No AbortController on external API calls → hang risk on slow upstream
- Bulk push serial loop: 50 expenses × ~1.5s = 75s wall-clock
- No loading.tsx on heavy settings pages → blank-wait on nav
- No optimistic UI on settings save → perceived 800ms+ lag
