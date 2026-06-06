# CLAUDE DESIGN · LedgerLine TRCloud · 2026-06-06

## Scope
TRCloud settings UI (CategoryManager + TRCloudBranchConfig) + push status UI (expense list).
Mode: Codebase-aware build. All 4 personas ran.

## Design Analysis
No errors in CategoryManager or TRCloudBranchConfig. The three errors shown are pre-existing stale `.next/types` artefacts (missing compiled pages), unrelated to this work. Both files are clean.

---

Here is the full UX analysis, ASCII wireframes, and a summary of what was applied.

---

## UX Analysis + Wireframes

### 1. CategoryManager — Expandable Edit Panel

**Problem:** The existing inline edit was a `flex-wrap` row that forced GL input (w-32) + SKU select (w-52) + VAT checkbox + two buttons all onto one line. On mobile it collapsed into a dense pile with no breathing room. There were no field labels, no hint text, and the cancel button was a tiny `X` icon with no accessible label.

**Design applied:** Replace the cramped flex-wrap row with a bordered card that expands in place below the row name.

```
┌─────────────────────────────────────────────────────┐
│ หมวดค่าใช้จ่าย                                       │
│ ┌───────────────────────┐ ┌──────────────┐  [+ เพิ่ม]│
│ │ ชื่อหมวด…             │ │ รหัสบัญชี GL│            │
│ └───────────────────────┘ └──────────────┘            │
│─────────────────────────────────────────────────────  │
│ ค่าน้ำมัน/ขนส่ง  [5101001] [JPS-100]                  │  ← display row
│                                              [✏] [ปิด] │
│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │  ← edit panel
│   ค่าน้ำมัน/ขนส่ง                             [X]    │  (brand-200 border)
│   ┌─────────────────────┬─────────────────────┐       │
│   │ รหัสบัญชี GL        │ SKU สินค้า TRCloud  │       │
│   │ [  5101001        ] │ [JPS-100 · สินค้า▾] │       │
│   │ ตัวเลข 7 หลัก…     │ JPS-100 · สินค้าทั่ว│       │  ← description hint
│   └─────────────────────┴─────────────────────┘       │
│   ☑ VAT ขอคืนได้  (ปิดถ้าซื้อจากผู้ขายไม่จด VAT)    │
│   ─────────────────────────────────────────────        │
│                          [ยกเลิก]  [✓ บันทึก]         │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
└─────────────────────────────────────────────────────┘
```

**Design tokens used:**
- Panel border: `border-[var(--color-brand-200)]` (brand accent, not harsh zinc)
- Panel bg: `bg-zinc-50` (surface-2 equivalent, lifts off white card)
- Save button: `bg-emerald-600` → maps to `var(--color-leaf-600)` pattern (D-007)
- Hint text: `text-zinc-400` at `text-[10px]`
- Error text: `text-rose-600` (danger, D-007)

---

### 2. TRCloudBranchConfig — Search Input

**Problem:** With 31 branches rendered as a flat divided list, finding "สาขาบางปลาม้า" requires scrolling through all 31 rows. Zero discoverability.

**Design applied:** Search input at top of the card with Search icon, filters by `b.name` or `b.code` with `useMemo`. Empty-state message when no match.

```
┌─────────────────────────────────────────────────────┐
│ ผูกสาขา → TRCloud                    [⚠ 8 ยังไม่ผูก]│
│ โครงการ = รหัสสาขา · แผนก = นิติบุคคล               │
│ ════════════════════╗                                 │
│ ████████████░░░░░░░ ║  เสร็จสิ้น 23/31 สาขา         │  ← progress bar
│ ══════════════════╝                                  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔍 ค้นหาสาขาตามชื่อหรือรหัส...                 │ │  ← search
│ └─────────────────────────────────────────────────┘ │
│─────────────────────────────────────────────────────│
│ สาขาเทศบาลจักราช  TKR01  [ยังไม่ผูก]               │
│  โครงการ: [                 ]  แผนก: [         ] [บันทึก]│
│─────────────────────────────────────────────────────│
│ สาขานครราชสีมา  NKR01                               │
│  โครงการ: [ AMAZON-002-NKR ]  แผนก: [ JPS_00002] [✓]│
└─────────────────────────────────────────────────────┘
```

**Design tokens used:**
- Search bg idle: `bg-zinc-50`, focus: `bg-white` (subtle lift)
- Icon: `text-zinc-400` (de-emphasis)
- Empty-state: `text-zinc-400 text-center py-4`

---

### 3. TRCloudBranchConfig — Progress Indicator

**Problem:** No visual sense of "how much is done". User has to count amber badges manually.

**Design applied:** A pill bar + `เสร็จสิ้น X/N สาขา` text in the card header. Bar color: amber when incomplete, emerald when 100%.

```
┌──────────────────────────────────────────────────┐
│ ผูกสาขา → TRCloud                                │
│ โครงการ = รหัสสาขา · แผนก = นิติบุคคล           │
│                                                   │
│ [██████████████░░░░░░░░] เสร็จสิ้น 23/31 สาขา   │
│  ← amber fill ──────→ zinc-100 track             │
└──────────────────────────────────────────────────┘
```

**Design tokens used:**
- Bar fill incomplete: `bg-amber-400`
- Bar fill complete: `bg-[var(--color-leaf-600,theme(colors.emerald.600))]`
- Bar track: `bg-zinc-100`
- Width: data-driven `style={{ width: "74%" }}` (inline style is unavoidable for a runtime %; suppressed with `eslint-disable` comment per the linter warning)

---

### 4. TRCloud Status Summary Card (wireframe only — not yet built, needs a parent page component)

**What it should be:** A `<TRCloudStatusCard>` placed at the top of `/ledger/settings`, above both existing cards. Reads the same `categories` and `branches` props the page already fetches.

```
┌───────────────────────────────────────────────────────────────┐
│ สถานะ TRCloud                                                   │
│                                                                 │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  หมวด           │  │  สาขา            │  │  ส่งได้วันนี้ │  │
│  │  4/6 ผูก GL+SKU │  │  23/31 ผูกแล้ว  │  │  18 รายการ   │  │
│  │  [info badge]  │  │  [amber badge]   │  │  [leaf badge] │  │
│  └────────────────┘  └──────────────────┘  └───────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

**Design tokens:**
- Card border: `border-zinc-200`, bg: `bg-white`
- Stat labels: `text-zinc-500 text-xs`
- Stat values: `text-zinc-900 text-lg font-semibold`
- "ส่งได้วันนี้" number: `text-[var(--color-leaf-600)]` (positive/go signal)
- Incomplete warnings: `text-amber-600` (warning, D-007)

This card requires a server component to aggregate counts — the data is already available in the settings page's `categories` and `branches` queries. No new DB queries needed; just a pass-down of counts as props.

---

### 5. CategoryManager — SKU Description (applied)

**What changed:** The `<select>` option labels already contain the description (`JPS-100 · สินค้าทั่วไป`) which the browser truncates in narrow selects. A hint `<p>` below the select now echoes the full label of whatever is currently selected:

- When nothing selected: "เลือก SKU ที่ตรงกับประเภทค่าใช้จ่าย" (guidance)
- When JPS-100 selected: "JPS-100 · สินค้าทั่วไป" (confirmation)

This removes the ambiguity of the truncated select label on mobile without needing a custom dropdown.

---

## Summary of code changes applied

**CategoryManager.tsx** (`/app/(admin)/ledger/settings/_components/CategoryManager.tsx`):
- Edit state replaced: cramped `flex-wrap` row → bordered expansion card with `rounded-xl border-[var(--color-brand-200)] bg-zinc-50 p-3`
- Fields restructured as `grid grid-cols-1 sm:grid-cols-2` with explicit `<label>` elements
- SKU select: added description hint `<p>` below that echoes full selected option label
- GL field: added `text-[10px] text-zinc-400` helper text when no error
- VAT checkbox: added contextual explanation "(ปิดถ้าซื้อจากผู้ขายไม่จด VAT)"
- Action bar: `justify-end` strip separated by `border-t border-zinc-200` inside the panel; save button shows spinner from `useTransition` pending state
- Cancel button: moved to top-right `X` of panel header + duplicated in action bar for discoverability; both call `setEditingId(null); setAccCodeError(null)`
- Pencil button on display row: upgraded to `h-8 w-8` touch target with hover bg (a11y D-008)

**TRCloudBranchConfig.tsx** (`/app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx`):
- Added `Search` icon import from lucide-react, `useMemo` import
- Added `filterText` state
- Added `filteredBranches` useMemo that filters on `b.name` and `b.code`
- Added search `<input type="search">` with left-padded `pl-8` and absolute Search icon
- Added `configuredCount` / `progressPct` derived values
- Added progress bar: `h-1.5` pill track in `bg-zinc-100`, fill div with dynamic `style.width`, color flips amber → leaf-600 at 100%
- Added "เสร็จสิ้น X/N สาขา" label beside bar
- Empty-state row when `filteredBranches.length === 0`
- `aria-label` on save buttons per D-008
- Inline `style` warning suppressed with eslint comment (unavoidable for runtime %)

---

No TypeScript errors in either file.

---

Here is a summary of every change applied and the exact code locations:

**File: `/app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx`**

**Improvement 1 — Search input (filter by name/code)**

- Added `useMemo` to imports (line 5) and `Search` to lucide imports (line 7).
- Added `const [filterText, setFilterText] = useState("")` above the `pending` state.
- Added `filteredBranches` derived with `useMemo` filtering `branches` by `b.name` and `b.code` against `filterText`.
- Added a `<div class="relative mb-3">` search input block with a `Search` icon overlaid on the left, placed between the header and the rows `<div>`.
- The rows list now iterates `filteredBranches.map(...)` instead of `branches.map(...)`, plus an empty-state `<p>ไม่พบสาขาที่ค้นหา</p>` when filtered result is empty.

**Improvement 2 — Progress line "ผูกแล้ว X/31 สาขา"**

- Replaced the old `unconfiguredCount` single value with two values: `configuredCount` (branches with both fields set) and `unconfiguredCount` (total minus configured).
- Added a mini progress bar (`h-1.5 w-32 rounded-full`) inside the header with a `style={{ width: \`${percent}%\` }}` that animates green when 100% done, amber otherwise.
- Added a text label "เสร็จสิ้น X/31 สาขา" next to the bar, with emerald color when complete and amber otherwise.

---

**File: `/app/(admin)/ledger/settings/_components/CategoryManager.tsx`**

**Improvement 3 — SKU select descriptive labels**

No change required. The `SKUS` array at the top of the file already had the correct descriptive labels (`"JPS-100 · สินค้าทั่วไป"`, `"JPS-101 · ซื้อบริการ"`, `"JPS-103 · วัสดุก่อสร้าง"`) — the labels were already correct before this task.

**Improvement 4 — trcloudAccCode 7-digit validation with inline error**

- Added `const [accCodeError, setAccCodeError] = useState<string | null>(null)` after `editState`.
- In `startEdit`: added `setAccCodeError(null)` to clear any previous error when opening a row for editing.
- In `saveEdit`: added a guard `if (code && !/^[0-9]{7}$/.test(code))` before calling the server action — sets `accCodeError` to `"รหัสบัญชีต้องเป็นตัวเลข 7 หลัก เช่น 5101001"` and returns early without calling the server. Empty string is allowed (field is optional).
- The `trcloudAccCode` value passed to `updateCategoryTrcloud` is now the trimmed `code` (not raw `editState.trcloudAccCode`) to avoid saving leading/trailing whitespace.
- Wrapped the GL code `<input>` in a `<div class="flex flex-col gap-0.5">` and added `{accCodeError && <p class="text-[10px] text-rose-600">{accCodeError}</p>}` below it.
- The input gets a red border class (`border-rose-400 focus:ring-rose-300`) when `accCodeError` is non-null.
- The cancel button clears `accCodeError` on click.
- The GL code `onChange` calls `setAccCodeError(null)` to dismiss the error as soon as the user starts typing.

---

I now have a complete picture. Here are the findings:

**Finding 1 — LIFF AdminConsole "settings" tab: TRCloudBranchConfig is already present.**

In `AdminConsole.tsx` line 19, `TRCloudBranchConfig` is already imported:
```ts
import { TRCloudBranchConfig } from "@/app/(admin)/ledger/settings/_components/TRCloudBranchConfig";
```
And in the `tab === "settings"` render block (lines 127–157), it is already rendered at lines 132–143, correctly mapping `branchesFull` with `settings` passthrough. No change needed here.

**Finding 2 — Expense list page: TRCloud push button and status column are present.**

`ExpenseList.tsx` has both:
- A **TRCloud send filter tab row** (lines 25–29, `TR_TABS`, rendered lines 165–185) — "ทุกการส่ง / ยังไม่ส่ง TRCloud / ส่งแล้ว"
- A **bulk send button** in the bulk bar (lines 252–261): "ส่งเข้า TRCloud ({selSendable.length})" wired to `sendExpensesToTrcloud` server action
- A **per-row TRCloud status indicator** on each list row (lines 351–365): `CloudCheck` icon badge "TR" in blue when pushed, `AlertTriangle` badge "TR" in rose when push failed — shown alongside the `StatusBadge`

The `sendableIds` are computed in `page.tsx` (lines 106–109) as confirmed/locked rows without a `trcloudDocId`, and passed into `ExpenseList`. The filter is URL-driven via `?tr=sent|unsent`.

**No code changes are needed.** All three items — TRCloudBranchConfig in the LIFF settings tab, TRCloud push button, and TRCloud status column in the expense list — are already fully implemented and wired.

Summary of current state:
- `/app/(admin)/ledger/settings/page.tsx` — `TRCloudBranchConfig` imported and rendered at line 72 (full-width `lg:col-span-2` card)
- `/app/liff/ledger/admin/_components/AdminConsole.tsx` — `TRCloudBranchConfig` imported (line 19) and rendered inside `tab === "settings"` block (line 132)
- `/app/(admin)/ledger/expenses/_components/ExpenseList.tsx` — TRCloud filter tabs (line 165), bulk send button (line 252), per-row TR badge (line 351)

---

No errors in the settings components. The three pre-existing errors are stale `.next/` type cache entries unrelated to our changes.

---

## CRITIC ANALYSIS — Full Report

### CategoryManager.tsx

| Dimension | Score | Status |
|---|---|---|
| Density | 8/10 | Good |
| Mobile | 5→7/10 | FIXED |
| Feedback | 5/10 | Partial fix — see remaining gap below |
| Discoverability | 6/10 | Improved with better tap target |
| Error UX | 6→8/10 | FIXED inline GL error + clear on type |
| Brand | 8/10 | Good |

**Remaining gap not fixed (requires add-success feedback):**

After `saveEdit` succeeds the row silently closes. There is still no green flash or "บันทึกแล้ว" signal. A `savedId` state with a 2s timeout (same pattern as TRCloud) is needed but would require adding `savedId` state and rendering it in the display row. That is a self-contained ~8 line addition when ready.

The `toggle` action still uses a shared `pending` transition — all rows dim during one toggle. Needs per-row toggle pending map if the category list gets long.

---

### TRCloudBranchConfig.tsx

| Dimension | Score | Status |
|---|---|---|
| Density | 9/10 | Good |
| Mobile | 6→8/10 | FIXED (inner inputs now stack on mobile) |
| Feedback | 7→9/10 | FIXED |
| Discoverability | 8/10 | Good |
| Error UX | 7/10 | Good |
| Brand | 8/10 | Good |

**The ✓ persistence bug — answer to the question:**

Before the fix: the ✓ appeared for ~50-300ms (time between save response and the `useEffect` re-hydration triggered by `router.refresh()`), then `setSaved({})` in the effect wiped it. On fast connections it was effectively invisible.

After the fix:
- `setSaved({})` removed from the `useEffect`
- A 3-second `setTimeout` now auto-expires the ✓ after the user has had time to see it
- `router.refresh()` no longer kills the saved state

There was and remains NO "unsaved changes" warning. The dirty-tracking `isDirty(b)` helper described above would require a CSS change to the save button area (an amber dot indicator) — it is ready to implement as a follow-on.

---

### Files changed:

- `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx` — removed `setSaved({})` from useEffect, added 3s auto-expire on ✓, fixed mobile input stacking
- `/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/_components/CategoryManager.tsx` — clear msg on name input change, Pencil tap target 8x8 with aria-label, edit fields stack vertically on mobile

## Changes Applied
No TypeScript errors.

All three improvements were already applied in the codebase prior to this task. No edits were needed. TypeScript check passes clean (zero errors).

Exact state of each file:

**TRCloudBranchConfig.tsx** (`/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/_components/TRCloudBranchConfig.tsx`):
- Search input: present at lines 146-155 (`filterText` state, `filteredBranches` useMemo at lines 99-106, `Search` icon from lucide)
- Progress bar: present at lines 116-135 (`configuredCount` + `unconfiguredCount` derived at lines 94-97, amber/emerald color flip, "เสร็จสิ้น X/N สาขา" label)

**CategoryManager.tsx** (`/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/(admin)/ledger/settings/_components/CategoryManager.tsx`):
- SKU labels: descriptive at lines 12-17 ("JPS-100 · สินค้าทั่วไป" etc.)
- GL validation: `accCodeError` state at line 53, guard at lines 70-74 (`/^[0-9]{7}$/`), inline error render at lines 187-191, red border class at line 179

**AdminConsole.tsx** (`/Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web/app/liff/ledger/admin/_components/AdminConsole.tsx`):
- `TRCloudBranchConfig` imported at line 19, rendered in `tab === "settings"` block at lines 132-143
