# UpSpeed · ChairOps · 2026-09-20

> `/upspeed` · 3rd (final) skill in a CEO-requested chain: `/auditbigteam` (diff-audit) → `/bigsolvebug` (11 correctness fixes) → **`/upspeed` (this doc)**
> Module was already upspeed'd twice before (2026-06-14, 2026-07-08) — both scored **0 felt fixes needed**, confirming a disciplined-built module. Per that history's own lesson ("when a module was upspeed'd before, diff what's NEW since that run"), this pass profiled only the ~35 commits since 2026-07-08, not the whole 68k-LOC module again.
> Branch: `claude/chairops-upspeed-2026-09-20` (stacked on `claude/chairops-bigsolvebug-2026-09-20`, off `origin/setup`, pushed, **not merged/deployed**)

## §summary

- Real production row counts are tiny (ChairopsBranchDailyRevenue=4303 the largest table) — most of what a generic profile would flag (indexes, over-fetch) is scale-only here, same verdict as both prior runs. The 3 lens agents this run correctly found little of that shape.
- **3 genuinely felt fixes shipped**, all S-effort, none touch money math: the maid deposit flow no longer waits on 2 external API calls to confirm; 4 places doing a redundant extra page-refresh were found and 3 fixed (1 correctly left alone after verification — see below); the maid roster page gets a shape-matched loading skeleton instead of falling through to a mismatched one.
- **4 real findings deferred to round-2** — genuine but M-effort or lower urgency, listed below with reasoning.
- **1 false positive caught before shipping**: a lens agent flagged `maid-status-buttons.tsx`'s `router.refresh()` as redundant with the server action's own `revalidatePath`. Checked where the component actually renders (`/chairops/maids`, via `branch-roster-view.tsx`) against what the action revalidates (`/chairops/users` only) — they don't match, so removing it would have broken the resign/reactivate buttons' visible refresh on the page they're actually used on. Left unchanged.

## §fixed (this run)

| # | Impact | Effort | What | file:line |
|---|---|---|---|---|
| 1 | HIGH | S | `batchDeposit()` awaited Gemini OCR + Google Drive backup before the maid saw "ฝากเงินแล้ว" (+2-6s typical, 15s+ worst case — the only timeout in the chain). Moved both into `after()`; `recomputeDriftForBranch` stays awaited (cheap, needs to be accurate immediately). | `app/(admin)/chairops/collect/actions.ts:627-729` |
| 2 | MED | S | 3 of 4 redundant `router.refresh()` calls removed (createBranch/addSingleChair/renameChair flow, branch close/reopen toggle, maid contract sign) — each action already `revalidatePath()`s the exact route the component renders on, confirmed before removing. | `branches/_manage.tsx`, `(office)/maids/_components/branch-close-buttons.tsx`, `(maid)/m/contract/contract-flow.tsx` |
| 3 | LOW-MED | S | `/chairops/maids` (roster table + filter pills) had no `loading.tsx`, fell through to the `(office)` group-root skeleton shaped for the KPI-tile dashboard — layout mismatch during load. Added a shape-matched table skeleton (also covers `/maids/[userId]`, `/pay`, `/contract` via inheritance). | `(office)/maids/loading.tsx` (new) |

## §not-fixed (false positive, verified before touching)

- `maid-status-buttons.tsx`'s `router.refresh()` (resign/reactivate maid buttons) — a lens agent flagged this as redundant with `deactivateUser`/`reactivateUser`'s own `revalidatePath`. Verified: those actions only revalidate `/chairops/users*`, but this component renders on `/chairops/maids` (a different route, via `branch-roster-view.tsx`/`branch-maids-popup.tsx`). Removing it would have broken the visible refresh on the page it's actually used on. **Left unchanged, no fix needed.**

## §deferred (real, round-2)

| # | Impact | Effort | What | Why deferred |
|---|---|---|---|---|
| 4 | MED-HIGH | M | `getReconcileChecklistNumbers()`'s "🔢 ตัวเลข" view fans out `getReconcilePeriods()` across all ~48 active branches with no concurrency bound — each does 6-8 sequential queries, so ~250-350 round trips against a `pg.Pool` with the default max of 10 connections. The exact same anti-pattern was already found and fixed elsewhere in this codebase (`recomputeAllDrifts`, bounded to `CONCURRENCY=5`) — this view reintroduces the shape one file over. | Gated behind an opt-in view (not the default checklist), CEO already accepted "heavier than the dot checklist" as a tradeoff when it shipped. Real risk before this view is promoted to default; fix is either bound-concurrency (quick) or batch the underlying queries org-wide (better, more work). |
| 5 | MED | S-M | `computeStreamSuspects()` (broken-chair detector, `/chairops/damage?tab=suspects`) queries `ChairopsPosDaily` in a plain sequential `for...of` loop, one query per branch (~30-48 serial round trips), not even `Promise.all`'d. Not cached, reruns from scratch every page load — and the new "🔄 เช็คตู้เสียด่วน" button (07-22) exists specifically to force a fresh rerun. | Real and page-load-scoped rather than a hot inner loop; batching (one `findMany` with `branchId: {in:[...]}`, bucket in-memory) is the same well-understood pattern as #4 but touches alert-detection logic — wanted a dedicated pass rather than folding into this batch. |
| 6 | MED | M | `(maid)/layout.tsx` pays a ~200-400ms "layout tax" on every navigation in the maid PWA — the same `chairopsUser` row gets looked up 3 separate times per nav, plus 2 extra Supabase REST calls for module-access checks that ADMIN-tier users skip via a fast path. Hits the single most latency-sensitive persona (mobile, Android Go, explicitly documented as the design target). | Touches shared auth code (`lib/chairops/auth/session.ts`, `lib/auth/module-access.ts`) used by other roles/modules too — a correctness-sensitive refactor, not a local S-effort change. Wanted broader review before touching session/entitlement code shared across the app. |
| 7 | LOW/scale-only | M | Reconcile tab switching (`ReconcileShell`) has no internal `<Suspense>` boundary — every tab/filter click re-suspends the whole page and re-shows the full 3-pane skeleton, not just the changed panel. Pre-existing architecture since 2026-05-28, not a regression. The new "🔢 ตัวเลข" tab is explicitly the heaviest (~48-branch fan-out per the code's own comment), so this ceiling gets more noticeable as branch count grows. | Explicitly scale-only today (the skeleton is layout-matched enough not to register as "broken" — consistent with both prior "0 felt fixes" verdicts); worth a proper `<Suspense>`-per-tab refactor once #4's fan-out cost is bounded, not before. |

## §regression-pass

- `find app/(admin)/chairops -name loading.tsx`: still 8 (7 pre-existing + 1 new), all group-root/route-group inheritance intact, no regression from the two prior "0 fixes needed" runs.
- `tsc --noEmit`: 0 errors. `next build`: clean, exit 0. `eslint` on all 5 touched files: 0 errors/warnings.
- Transaction pooler (`:6543`) and `optimizePackageImports` (covers `lucide-react`) both confirmed still correctly configured — no regression, repo-wide config unchanged.

## §next-actions (CEO must decide)

- This branch is stacked on the bigsolvebug branch, neither merged/deployed — same standing deploy-approval gate as the other two skills in this chain.
- Round-2 candidate list is §deferred above — no urgency to schedule, all are either gated-behind-opt-in or scale-only today.

## §lessons-this-run
- 💚 worked: the "diff since last upspeed" approach (35 commits, not 89) kept this to 3 lens agents instead of a full 6-lens re-scan, and still found 3 real felt issues + caught the redundant-refresh false-positive — the targeted approach didn't sacrifice thoroughness.
- 💚 worked: verifying each "redundant `router.refresh()`" finding against where the component ACTUALLY renders (not just which action it calls) before removing — caught one genuine false positive that a blind grep-and-delete would have shipped as a real regression.
- 🔧 next-run: when a lens agent finds "action already revalidates X, so the client-side refresh is redundant," always independently confirm the consuming COMPONENT is rendered on route X, not just that revalidatePath(X) exists somewhere in the call chain — components get reused across routes.
- 📊 cost: ~397k subagent tokens (3 lens agents) + orchestrator implementation (1 commit, 3 fixes, 1 correctly-declined false positive). Wall time ~15min discovery (parallel) + ~15min implement+verify.
