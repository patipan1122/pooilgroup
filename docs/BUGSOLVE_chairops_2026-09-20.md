# BugSolve · ChairOps · 2026-09-20

> `/bigsolvebug` · 9 read-only discovery/verify agents (5 persona-walk + 4/5 backend-verify against real prod data via the read-only DB role) → triage → CEO confirmed "fix all safe P0+P1" → 4 commits, 11 bugs fixed
> 2nd skill in a CEO-requested chain: `/auditbigteam` (diff-mode, done) → **`/bigsolvebug` (this doc)** → `/upspeed` (next)
> Branch: `claude/chairops-bigsolvebug-2026-09-20` (off `origin/setup`, pushed, **not merged/deployed**)

## §summary

- **Correction to the prior audit's headline finding**: `/auditbigteam`'s diff-audit (same day) flagged a "dual drift-calculator disagreement" as the #1 new finding. A dedicated real-data verification agent this run **refuted that specific claim** — 3 branches checked, ₿0 disagreement, because window-mode (where the two formulas could actually diverge) has never been activated by any branch. The REAL, precisely-verified bug is narrower and still real: the moment ANYONE clicks "ปิดงวด" for the first time, `ChairopsDrift.driftAmount` (read by Dashboard/alerts/write-off-approval) will reset toward 0, but the Periods/Ledger/Checklist pages (`reconcile-v2.ts`, which never reads `lastReconcileClosedAt`) will keep showing the old cumulative number for up to 365 days. Currently **dormant** (0 branches have ever closed a period) — will trigger the first time the flagship FIN-01 fix is actually used. See §deferred-decisions below — this needs a money-math design call, not a mechanical fix, so it was **not** auto-fixed this round.
- Fixed **11 bugs** across 3 P0 + 4 P1 + 4 P1/P2, all auto-fix-safe (no schema change, no CEO policy call). tsc 0 errors, `next build` clean, eslint 0 new errors — verified after every batch.
- 3 items need a CEO decision before they can be fixed — listed in §deferred-decisions, not touched this round per your explicit scope choice.

## §scope

- Discovery: 5 persona walks (Maid-Mobile, Office-Reconcile-Power, POS-Ingest-EdgeCase, BranchManager-Mobile, Auditor-Newbie) + 4 backend-verify agents (RLS/org-scope against real DB, drift-calc dual-formula against real DB, OCR fail-open against real DB, cross-page revalidation) — all read-only, hard no-write clause, money-table pre-flight/post-flight snapshot confirmed zero audit-caused writes.
- Fix: isolated worktree off `origin/setup`, 4 commits, tsc + `next build` + eslint verified clean after every batch.
- Cost: ~1.4M subagent tokens (9 discovery agents) + orchestrator implementation.

## §bugs-fixed

| # | Severity | file:line | Fix | Commit |
|---|---|---|---|---|
| 1 | P0 | `app/(admin)/chairops/pos-ingest/actions.ts:1190` | fire-and-forget drift/alert recompute (`void Promise.allSettled`) → `after()`, guaranteed to finish on Vercel; also closes the CSV self-heal timing gap since it's inside the same block | `20cc15dd` |
| 2 | P0 | `app/(admin)/chairops/(maid)/error.tsx` (new) + `m/collect/new/form.tsx` + `m/deposit/form.tsx` | maid route group had zero error boundaries + no try/catch on money submits — dropped connection (routine on her persona) crashed to Next's generic error page, losing her in-progress entry | `20cc15dd`, `39e21de3` |
| 3 | P0 | `lib/chairops/queries/branches-workspace.ts` + `app/(admin)/chairops/branches/page.tsx` | closed/inactive branches rendered as "ปกติ" (normal) with a plain green dot — worse than hidden. Added a distinct "closed" status/view/group bucket across query + rail + detail-pane + group-by-status buckets | `20cc15dd` |
| 4 | P1 | `lib/chairops/reconcile/actions.ts` (`closePeriodForOrg`) | missing `revalidatePath` for `/chairops/branches` + every affected branch's reconcile detail page (resets ALL branches at once, only busted the list) | `93f5fe9d` |
| 5 | P1 | `app/(admin)/chairops/collect/actions.ts` (`batchDeposit`) | same gap for the branch's own reconcile detail page + branches workspace | `93f5fe9d` |
| 6 | P1 | `lib/chairops/queries/exec-home.ts` + `(office)/page.tsx` | `MissedMaidsCard` list bypassed the cut-off gate entirely — KPI tile correctly said "0 คน" before 17:00 while the card below it still listed real branches as missed, the exact false alarm CO-WF-01 killed, just relocated | `93f5fe9d` |
| 7 | P1 | `lib/chairops/reconcile/actions.ts` + `reconcile-sidebar.tsx` | bulk-send-to-reconcile only reported aggregate counts ("พลาด 1 สาขา") — clerk had to reopen all N branches by hand to find which. Now returns per-branch results, toast names the failed branch(es), keeps only those selected for one-click retry | `93f5fe9d` |
| 8 | P1 | `(office)/write-offs/actions.ts` | bulk-approve loop had zero error handling, no client catch either — one bad row threw uncaught with no signal of how many of N landed. Isolated per-row, reports approved/failed counts | `c0c5c2f8` |
| 9 | P2 | `pos-ingest/actions.ts` (3 `createMany` calls) | ChairopsChair / ChairopsPosDaily / ChairopsBranchDailyRevenue all have real unique constraints but no `skipDuplicates` — a race (e.g. gmail-import cron mid-manual-upload) threw P2002 and rolled back the WHOLE commit instead of skipping the already-landed row | `c0c5c2f8` |
| 10 | P2 | `api/chairops/cron/recompute-drifts/route.ts` | comment claimed "every 30 min", schedule has always been once/day — fixed the comment to state the real worst-case gap (~24h); did **not** change the schedule (cost decision, not mechanical) | `c0c5c2f8` |
| 11 | P2 | `pos-ingest/actions.ts` (`commitImport` catch-all) | re-threw raw error → `error.tsx` rendered it directly to OFFICE-tier staff (possible Postgres/Prisma message leak), lost the commit checklist UI. Transaction is all-or-nothing so nothing was written either way — now a safe generic message, real error logged server-side | `c0c5c2f8` |

## §deferred-decisions (need CEO input, not auto-fixed)

1. **Close-period ↔ Periods-page sync** (the corrected headline finding above) — money-math change, needs FIN+OFC+AUD-lens care before shipping. Recommend: repoint `reconcile-v2.ts`'s ledger replay to respect `lastReconcileClosedAt`, or add a divergence assertion that alerts if the two ever disagree by more than a few baht.
2. **FIN-03** (deposits flagged `requiresReview` — old ≥500฿ threshold + new AI slip-fraud flag — counted into the main shortage number immediately, not held until office clears) — same open question as the 06-15 audit, unchanged.
3. **`/api/chairops/audit-export` permission mismatch** — the audit page requires `CEO` role, but the export route requires `ADMIN`, and in this app's rank hierarchy `ADMIN` (5) outranks `CEO` (4) — so even if a button were added, a plain CEO viewing the page would get a 403 calling it. Needs a decision on which role should actually be able to export (loosening a permission gate, not purely mechanical).

## §not-touched (documented, lower priority)

- SEC-01 (RLS decorative on `chairops` schema) — confirmed with real DB evidence (`postgres` role has `rolbypassrls=t`), but `anon`/`authenticated` have zero grants so there's no live exploit path with 1 tenant. Architecture backlog, pre-2nd-tenant gate.
- Cross-org crons (eod-reminder/sop-check/ceo-digest) — unchanged, low urgency single-tenant.
- `slipImageHash` dedup bypassable at the `batchDeposit` call (mitigated by the OCR fraud-check as a second line of defense) — real but lower-frequency; fixing needs binding the hash to the actual upload event (short-lived signed token), a bit more involved than this round's batch.
- No void/edit path for a wrongly-submitted deposit — this is a new feature (correction/void action + maker-checker), not a bug fix; recommend a future ticket rather than a rushed addition here.
- `drive-offload` cron built but never registered in `vercel.json` — "turn on a cost-saving feature" decision, not a bug.
- MIME validation trusts client-declared type (coerces rather than rejects) on both slip and chair-evidence photos; client/server file-size limit mismatch (12MB vs 8MB) for deposit slips; HEIC skips compression entirely. All real, all P2, none money-critical.

## §regression-pass

- `tsc --noEmit`: 0 errors after every batch (4 checkpoints).
- `next build`: clean, all ~700 routes compiled, exit 0.
- `eslint` on all 13 touched files: 0 errors after the one fix (unescaped quotes in the new `error.tsx`) — 2 other files showed pre-existing lint issues confirmed via `git diff origin/setup` to be **outside** this run's diff (not introduced here, left untouched per scope).
- Money-table pre-flight/post-flight snapshot (before discovery agents ran / after fixes committed): only organic live branch activity, zero audit-or-fix-caused writes.

## §next-actions (CEO must decide)

- See §deferred-decisions above (3 items).
- This branch is **not merged/deployed** — awaiting your go-ahead to push to `setup` (per the repo's standing deploy-approval rule).

## §lessons-this-run
- 💚 worked: money-Module Pre-Flight + independent real-DB verification caught the audit's own headline finding was overstated — the pattern of "verify with real data, not just code-reading" earns its seat again, this time catching the auditor's own miss, not a persona's.
- 💚 worked: clustering discovery into targeted persona walks (not the full generic 25-sim matrix) + 4 focused backend-verify agents, informed by the prior audit's findings, found 3 genuinely new P0s the audit's code-reading alone hadn't surfaced (maid crash, branch camouflage, revalidation gaps) at a fraction of the token cost of a blind full crawl.
- 🔧 next-run: when a diff-mode audit's headline finding is money-math-shaped, always follow up with a real-data verify agent before treating it as fact in the next skill's briefing — code-reading alone (even careful code-reading) can overstate a formula-disagreement claim if it doesn't check whether the divergent code path is actually reachable yet.
- 📊 cost: ~1.4M subagent tokens (9 agents) + orchestrator implementation (4 commits, 11 bugs). Wall time ~40 min for discovery (parallel) + ~30 min implementation+verify.
