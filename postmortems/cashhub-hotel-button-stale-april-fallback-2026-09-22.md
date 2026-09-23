# Post-mortem: CashHub "ตรวจยอดขายโรงแรม" button silently landed on stale April-2026 pilot data

**Summary.** The "🏨 ตรวจยอดขายโรงแรม" links on the CashHub dashboard (`app/(admin)/cashhub/dashboard/dashboard-v1-view.tsx`, header + footer shortcut) hardcoded `href="/cashhub/hotel"` with no `branchId`/`month` query params. The hotel detail page (`app/(admin)/cashhub/hotel/page.tsx:83`) defaults `month` to a hardcoded `"2026-04"` — the original pilot month — whenever the param is absent, instead of the current month. So every click on those two links silently opened five-month-old data with no error or visual cue, which the CEO experienced as the button "jumping to some page I don't recognize." The dashboard's own "โรงแรม - MIX" summary card already computed the correct dynamic link (`hotelSummary.monthHref`, built in `lib/cashhub/hotel-sheet-sync.ts:378` with the real branch + latest-data month) — the fix routes both button links through that same value instead of duplicating the bare path. Branch `claude/cashhub-hotel-link-fix-2026-09-21`, commit `559864cf` fast-forward-merged onto `setup`. **Deployed live 2026-09-22.**

**Symptom.** CEO sent two screenshots: the CashHub dashboard overview, and the hotel detail page they expect to land on. Message (Thai): clicking hotel sales on the dashboard "jumps to some page I don't know, I want it to jump to [the hotel detail page] instead because that's the real working page." No crash, no console error, no redirect to a different route — the button always went to the *right* route, just with stale data baked in via the default.

**Root cause.**
```tsx
// app/(admin)/cashhub/dashboard/dashboard-v1-view.tsx:117 (before)
<Link href="/cashhub/hotel" ...>🏨 ตรวจยอดขายโรงแรม</Link>
// duplicated at line 517 (footer "ทางลัด" shortcut row)
```
```tsx
// app/(admin)/cashhub/hotel/page.tsx:80-83
const branchId = sp.branchId ?? branchWithData ?? branches[0]?.id ?? null;
// ── เดือน (default = เม.ย. 2026 pilot) ───────────────────────────────
const monthStr = sp.month ?? "2026-04";
```
The hotel page's `month` fallback is an intentional leftover from the original pilot rollout (comment: "default = เม.ย. 2026 pilot"), not itself a bug — the page is meant to be reached with explicit params. The bug is that two of the primary entry points to that page never supplied them, so every visitor silently fell through to the pilot-era default five months in the past. Meanwhile the dashboard's hotel summary card (`hotelSummary.monthHref`) already builds the correct link dynamically:
```ts
// lib/cashhub/hotel-sheet-sync.ts:378
monthHref: `/cashhub/hotel?branchId=${branch.id}&month=${monthStr}`,
```
where `monthStr` is resolved from the latest month that actually has data in `cashhub_hotel_daily` (`hotel-sheet-sync.ts:336-373`) — this link was already correct and unaffected.

**Why it produced the symptom.** With no params, `branchId` also falls back through `branchWithData ?? branches[0]?.id` — correct today only because there is exactly one active hotel branch (MIX). The `month` fallback has no such safety net: it always resolves to `2026-04` regardless of what month it actually is, so a bare `/cashhub/hotel` visit in September 2026 rendered a hotel page that *looked* fully functional (correct branch, real historical data, no error state) but showed figures five months old — indistinguishable from "wrong page" to someone not checking the month label closely.

**Fix.** Branch `claude/cashhub-hotel-link-fix-2026-09-21`:
- `dashboard-v1-view.tsx:117` and `:517` — `href="/cashhub/hotel"` → `href={hotelSummary?.monthHref ?? "/cashhub/hotel"}`, reusing the already-correct dynamic link the summary card uses, rather than inventing new resolution logic. `hotelSummary` is an existing optional prop on this component (populated by `loadHotelCardSummary(...).catch(() => null)` in the parent server component, `dashboard/page.tsx:48`) — the `?? "/cashhub/hotel"` fallback only matters on the rare error/no-data path (no active hotel branch, or a sync failure), and reproduces prior (not worse) behavior in that case.
- Did not touch the `"2026-04"` default inside `hotel/page.tsx` itself — it's a deliberate historical default for a page designed to always be reached with explicit params; changing it was out of scope for this fix and flagged to the CEO as an optional follow-up rather than done unilaterally.
- Audited every other reference to `/cashhub/hotel` in the repo: three `BackButton fallbackHref="/cashhub/hotel"` usages (`hotel/iv/page.tsx`, `import/hotel/page.tsx`, `hotel/settings/page.tsx`) carry the same bare-path issue, but only trigger when there's no browser history to go back to — much lower frequency than a primary nav button — left unfixed pending CEO decision.

**How it was found.** An Explore subagent traced every render/link site touching `/cashhub/hotel` from the CEO's two screenshots (breadcrumb text "ตรวจยอดขายโรงแรม" pointed at the header button specifically), located both hardcoded hrefs, the dynamic `hotelSummary.monthHref` pattern already in use by the card, and the hardcoded `"2026-04"` fallback in the target page — all read-only, no code changed during investigation. A plan was presented to and approved by the CEO before any edit (per project workflow rule requiring sign-off before code changes on this codebase).

**Why it slipped through.** The bug was invisible in normal review because the destination page never errors — it renders a complete, real, correctly-formatted hotel report every time, just for the wrong month. There's no automated check (test or lint rule) for "internal `<Link>` to a page with a stale hardcoded default is missing its query params" — this class of bug (a plausible-looking response masking wrong data) only surfaces when a human notices the date doesn't match "today."

**Validation.** `./node_modules/.bin/tsc --noEmit`: 0 errors (run twice — after each rebase onto a moving `origin/setup`, since two other sessions pushed unrelated commits to `setup` while this fix was in flight). `eslint` on the changed file: 0 errors/warnings (repo-wide `eslint .` separately confirmed 345 pre-existing errors / 3677 warnings, all in unrelated `scripts/` tooling, none touching this file — not introduced by this change). `npm run build`: succeeded both times, all routes generated, exit code 0. `git status --porcelain`: clean at push time. Live smoke test before push: `pooilgroup.com/`, `/login`, `/signup` all returned healthy 200/307. Post-deploy: confirmed the new Vercel production build finished (`vercel ls`, Building → Ready, ~2m), then used a real authenticated Playwright session (test admin account, read-only — no data submitted) to log into `pooilgroup.com`, load `/cashhub/dashboard`, and confirm both "ตรวจยอดขายโรงแรม" links now resolve to `/cashhub/hotel?branchId=00000000-0000-0000-0000-0000000000b1&month=2026-09` (matching the card's link exactly), then clicked through and confirmed the destination page renders heading "โรงแรม - MIX ก.ย. 2569" (September 2026, the current month) with no error and no trace of the old April default anywhere in the rendered page.

**Action items / follow-ups.**
- Optional, not done: change `hotel/page.tsx`'s hardcoded `month` fallback from `"2026-04"` to the current month, as defense-in-depth against any future bare link to this route. Left to a future CEO decision since the current default may still be intentional for some workflow not surfaced during this investigation.
- Optional, not done: the three `BackButton fallbackHref="/cashhub/hotel"` sites carry the same stale-default risk on the (rare) no-history path. Not fixed — lower priority, flagged to CEO.
- No regression test added — this codebase does not require unit tests during MVP phase (manual testing policy); the fix was validated end-to-end in a live browser session instead.
