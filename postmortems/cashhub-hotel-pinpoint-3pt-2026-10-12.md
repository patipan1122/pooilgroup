# Post-mortem: CashHub hotel-sales entry point drift + inline TTB upload (2026-10-12)

**Summary.** A CEO Pinpoint click-report flagged 3 friction points on CashHub's hotel-sales flow (`/cashhub/import`, `/cashhub/hotel`). Root cause: the import hub's "ยอดขายโรงแรม" card still pointed at a legacy manual-upload page (`/cashhub/import/hotel`) superseded by realtime Google Sheet sync since Aug 2026; the destination page's own `month` param silently defaults to a hardcoded `"2026-04"` pilot value when omitted, which a naive one-line href fix would have reintroduced; and the TTB bank-file upload control lived only on a separate `/iv` page, forcing navigation away just to upload a file. Fixed in commit `7deabe0e` (pooilgroup-web, `origin/setup`). Deployed live, verified via headless Playwright against `pooilgroup.com` matching the CEO's original screenshots exactly.

## Symptom

- **Point 1:** clicking "ยอดขายโรงแรม" on `/cashhub/import` landed on `/cashhub/import/hotel` (a manual Excel-upload form) — CEO: "คืออันนี้ ไม่ได้ใช้หน้านี้แล้วตอนกดเข้าไปอ่ะ".
- **Point 2:** completing a manual import required an extra click ("ดูหน้าตรวจยอดขาย →") to reach the actual sales page.
- **Point 3:** verifying "QR เข้าบัญชี" against a real bank statement required navigating to `/cashhub/hotel/iv`, a full separate page, just to upload a TTB file — CEO: "อัพไฟล์ตรงที่กดไปมันจะข้ามไปอีกหน้านึงเพื่ออัพไฟล์ ให้อัพได้เลยโดยไม่ต้องกดข้ามหน้าไปไง".

## Root cause

1. `app/(admin)/cashhub/import/page.tsx`'s `SOURCES` array entry for `slug: "hotel"` (~line 106-113) had no `href` override, unlike the `cafe-amazon`/`tea` entries which do (`href: "/cashhub/amazon"`, `href: "/cashhub/tea"`). The card-render fallback — `s.href ?? \`/cashhub/import/${s.slug}\`` (~line 156) — therefore always resolved to `/cashhub/import/hotel`, the original manual-upload-only entry point that predates the Aug-2026 realtime sheet-sync feature (`lib/cashhub/hotel-sheet-sync.ts`, comment: *"CEO 2026-08-06: อยากให้หน้าโรงแรมดึงชีตสด ๆ เอง ไม่ต้องกด 'นำเข้าจากชีต'"*). `app/(admin)/cashhub/hotel/page.tsx`'s own fallback link to that same manual page (~line 154-159) only fires when a branch has no sheet-sync config configured — i.e. the manual page is correctly a secondary path everywhere *except* the import hub card, which was never updated to reflect the shift.
2. `app/(admin)/cashhub/hotel/page.tsx:83`: `const monthStr = sp.month ?? "2026-04";`. This is the exact mechanism already fixed once for two dashboard-button hardlinks on 2026-09-22 (commit `559864cf`, see `cashhub-hotel-button-stale-april-link-fix-2026-09-22`) — but never fixed at this call site, which was outside that commit's scope. The obvious first-attempt fix (`href: "/cashhub/hotel"`) would have silently reintroduced the same stale-April-2026 bug class at a new entry point.
3. `app/(admin)/cashhub/hotel/iv/page.tsx` renders `<HotelTtbUpload branchId={...} month={...} history={ttbHistory} />` (~line 213) as step 2 of a 3-step page, alongside `HotelIvExcelView` (step 1, TRCloud IV pull) and `HotelReconcilePanel` (step 3, reconcile-send). `app/(admin)/cashhub/hotel/page.tsx` only linked to that page via a footer `<Link>` card, requiring full navigation for the single action of uploading a bank file.

## Why it produced the symptom

Points 1/2: the hub page's intended purpose shifted (realtime sync became primary, manual upload became fallback) but only the destination page's own internal fallback logic was updated to reflect that; the hub card is a separate call site with no shared source of truth for "where does the hotel entry point go," so it kept linking to the pre-shift destination indefinitely.

Point 3: `HotelTtbUpload` is a fully self-contained client component (props: `branchId`, `month`, `source`, `history`; POSTs to its own existing `/api/cashhub/hotel/ttb-upload` route) that happened to be composed only inside the `/iv` page's layout. Nothing about the component required that placement — it was a UI-density decision made 2026-08-11 to protect the *IV-pull + reconcile-send* steps (large, ~2,260 lines total), not a reason the upload control itself needed to be separated.

## Fix

Commit `7deabe0e`, branch `claude/cashhub-hotel-pinpoint-2026-10-12` fast-forwarded onto `origin/setup` (`0738e90b→7deabe0e`).

- `app/(admin)/cashhub/import/page.tsx`: compute `currentMonthStr` (Bangkok-timezone current month) once per request; special-case `s.slug === "hotel"` in the per-card href calculation to `/cashhub/hotel?month=${currentMonthStr}`, bypassing the generic `s.href ?? /cashhub/import/${slug}` fallback for this one entry.
- `app/(admin)/cashhub/import/hotel/hotel-import-shell.tsx`: removed the `done` state and its gated success-screen JSX; on successful `commit`, call `toast.success(...)` (sonner, already used elsewhere in this codebase) and `router.push(...)` immediately instead of waiting for a manual button click.
- `app/(admin)/cashhub/hotel/page.tsx`: imported `HotelTtbUpload`, duplicated the same `audit_logs`-based `ttbHistory` query `/iv/page.tsx` already runs (scoped to `action="IMPORT_HOTEL_SALES"` + `kind==='ttb'` + matching `branchId`), and replaced the footer `<Link>` card with `<HotelTtbUpload branchId={branchId} month={monthStr} history={ttbHistory} />` followed by a slimmer link to `/cashhub/hotel/iv` for the remaining IV-pull/reconcile-send steps, which were deliberately left in place.

This addresses root cause rather than symptom in all 3 cases: the href points at the actual intended destination, the month-default gap is closed at the specific call site about to reintroduce it, and the upload control renders where the user needs it instead of behind a "go here first" link.

## How it was found

Investigated via a read-only Explore-agent pass against `origin/setup` (not the local checkout, which can be stale) with 3 questions mapped 1:1 to the CEO's 3 Pinpoint comments. The agent cited exact file:line locations for the `SOURCES` array, the `cardProps` fallback logic, the `monthStr` default, and `HotelTtbUpload`'s props/call sites — confirmed directly against the real files before writing any code, not trusted blind. The stale-month risk (root cause 2) was caught specifically by reading the destination page's param-handling code before writing the "obvious" one-line href fix. Point 3's actual shape (embed the upload control itself, not just a summary view) only became clear after the CEO corrected an initial two-option proposal ("compact read-only summary+link" vs. "change what the KPI number means") — their own words identified the upload *action* as the friction, not the data visibility.

## Why it slipped through

Latent/drift gap, not a CI gap — there is no check covering "every active entry point to hotel sales resolves to the currently-correct destination with the currently-correct params." The import hub's `SOURCES` array and the hotel page's own internal fallback link were updated independently across separate sessions (Aug-2026 sheet-sync rollout, Sep-2026 dashboard-link fix) with no shared helper computing "the correct hotel URL" — each new entry point has had to independently remember to pass `month`, and this one didn't. Same bug *class* as the Sep-22 dashboard fix, at a call site that fix's scope didn't cover.

## Validation

**Local:** `NODE_OPTIONS=--max-old-space-size=10240 ./node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0 errors, whole project (after `prisma generate` in the fresh worktree — the first run without it produced 2,842 phantom errors from an unresolved `@/lib/generated/prisma` import, unrelated to this change and not real baseline noise). `./node_modules/.bin/eslint` on the 3 changed files → 0 errors/warnings. `./node_modules/.bin/next build` → exit 0, all routes compiled.

**Functional (local prod-mode server):** headless Playwright (390×844 mobile viewport) — clicked the hotel card, landed on `/cashhub/hotel?month=2026-10`, confirmed real data rendered (฿107,458 total / ฿42,913 cash / ฿15,630 QR / ฿15,800 OTA) matching the CEO's original Pinpoint screenshots exactly; scrolled to confirm the TTB upload widget + 7-entry upload history rendered inline; separately confirmed the manual-upload fallback page still renders correctly with no console errors.

**Functional (production, post-deploy):** repeated the same walkthrough against `pooilgroup.com`. Hit the known flaky-headless-login issue (`feedback-headless-login-flaky-needs-retry-2026-09-26`) — resolved with the documented retry-loop (force-click + cookie-presence check), succeeded on attempt 1 once applied. Confirmed identical results live.

**Not covered:** no concurrent-upload/race scenario exercised (the upload control is unmodified code reused as-is from `/iv`, already in production use, not a new risk surface introduced by this change). Did not submit an actual file upload end-to-end (would write real production import rows) — the upload component and its API route are unmodified, so this was out of scope for this fix.

## Action items

None — the fix is sufficient and no class-of-bug follow-up is warranted this session. (A repo-wide "every `/cashhub/import` SOURCES href resolves without a stale-default param" smoke check would be a reasonable future housekeeping item, but is not filed as a tracked action item here — it wasn't requested and is broader than this fix's scope.)
