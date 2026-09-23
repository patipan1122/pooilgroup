# UpSpeed · RentSpace · 2026-09-22

**Mode:** Recovery + Targeted. Step 3 (final) of a CEO-requested 3-skill chain on RentSpace only.

## §summary
- 🔑 **Major finding**: RentSpace WAS profiled once before (2026-07-22) but that commit (`cdf5ac66`) lived on a branch that was never merged into `setup` — none of its 3 proven fixes ever shipped. Re-applied all 3, adapted to how much the module changed since (move-out proration, soft-delete, new dashboard banner).
- ✅ Scoped-profiled the genuinely new surface (matrix page — didn't exist at the last profile — plus everything added in yesterday's `/bigsolvebug` pass). Mostly clean: no N+1 introduced by the soft-delete/permission threading. 3 real, cheap findings fixed.
- Module is still tiny-scale in prod (38 bills / 36 payments / 20 discounts / ~25 active contracts) — most classic index/over-fetch concerns are scale-only and were correctly not chased.

## §baseline → after
| Check | Before this run | After |
|---|---|---|
| `find app/(admin)/rentspace -name loading.tsx` | 1 (`meters/` only) | 3 (group-root + `meters/` + `matrix/`) |
| Dashboard units-dependent section | blocks KPI paint | streams behind `<Suspense>`, KPIs paint immediately |
| Bill-preview reads (batch + single-unit) | ~4×N sequential queries per preview | ~5 total queries (project-wide prefetch) |
| Existing-bill check in preview loops | 1 `findUnique` per contract | 1 batched `findMany` |
| Settings page fetch stages | 4 sequential | 2 parallel |
| Redundant `router.refresh()` (confirmed) | present on `RecordPaymentButton` | removed |

Client-nav feel (skeleton, streaming, batching) is not curl-measurable — ask to feel it by clicking around; the batch-preview + settings-page wins ARE measurable (fewer round-trips), verified via the query counts above, not re-timed against a live server in this pass.

## §fixed
1. `app/(admin)/rentspace/loading.tsx` — recovered from the lost 07-22 commit, group-root skeleton covers all 17+ previously-uncovered routes.
2. `app/(admin)/rentspace/page.tsx` — recovered `<Suspense>`-streamed `PlanAndAttention`, merged cleanly with yesterday's new slip-mismatch banner (banner stays in the fast shell, doesn't block the stream).
3. `lib/rentspace/billing.ts` + `app/(admin)/rentspace/_actions.ts` — recovered `prefetchBillInputs()` + optional `pre` param on `buildBill()`; also batched the existing-bill check in both preview loops (a further N+1 found adjacent to the original fix, not in the original 07-22 commit). **Verified money-safe against real data: 0 mismatches across all 25 active contracts.**
4. `app/(admin)/rentspace/matrix/loading.tsx` — new, table-shaped skeleton for the main daily-ops screen (was falling back to a generic list-shaped skeleton that didn't match the real grid).
5. `app/(admin)/rentspace/settings/page.tsx` — parallelized `getPermissionMatrix` (only needs orgId) with `getPrimaryProject`, and folded `recurringCharges` into the existing 3-item `Promise.all`. 4 sequential stages → 2 parallel ones.
6. `app/(admin)/rentspace/bills/[id]/_components/bill-detail-actions.tsx` — removed a confirmed-redundant `router.refresh()` on `RecordPaymentButton` (single render site, already covered by the action's own `revalidatePath`).

## §deferred (next-round, documented not done)
- Dashboard `getSlipMismatchBillIds` query runs sequentially after the shell's `Promise.all` instead of inside it — SCALE-ONLY at 38 bills (sub-ms), fold in whenever the file is next touched.
- Collections page `BillRow` payment-recording still does a full `router.refresh()` — a genuine `useOptimistic` opportunity for a high-frequency staff flow (room-to-room collection), rated MED/nice-to-have by the profiler, not urgent at 36 payments/25 contracts.
- Bill approval buttons (`RequestVoidButton`, `VoidDecisionButtons`, `DeleteBillButton`, `DeleteDecisionButtons`) also have a technically-redundant `router.refresh()`, but these are low-frequency actions (approving a request isn't a multi-times-a-minute click) — not worth the risk of touching 4 call sites for an unfelt win right now.

## §scale-only (not touched, correctly deferred)
- Any composite-index / over-fetch concern on RentSpace's 17 models — all tables are tens of rows, not thousands. Revisit if unit/bill counts grow 10x.

## §regression-pass
Checked the module against `~/.claude/skills/upspeed/slow-pattern-library.md`'s known false-positives (prisma globalThis singleton, pg.Pool default max) — both confirmed still correctly NOT flagged. All prior fixes from the 07-22 run (now finally live) re-verified present and working.

## §verification
`tsc --noEmit` 0 errors · scoped `eslint` 0 errors on all touched files · `next build` exit 0, all routes compiled including the new `matrix/loading.tsx` · 25/25 existing tests pass unchanged · money-table row counts unchanged (38/36/20, 0 soft-deleted) · real-data verify of the batched prefetch against live per-contract queries: 0 mismatches / 25 active contracts.

## §lessons-this-run
See `~/.claude/skills/upspeed/LESSONS.md` (appended) — headline lesson: a whole prior upspeed run's output can be silently lost if its commit lands on a branch that never merges. Worth a repo-wide sweep for other "perf(...)"-prefixed commits sitting on unmerged branches.
