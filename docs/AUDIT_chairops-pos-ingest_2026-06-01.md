# AUDIT · chairops/pos-ingest · 2026-06-01

> Post-implementation audit of the multi-file POS uploader pipeline.
> Scope: 26 commits today (03084e7..dad32f7).
> Mode: Lean (8 personas inlined · scope narrow · author has full context).
> Status: 🟢 SHIPPED + verified end-to-end (cash 15,504 + coin 2,374 + daily 1,012 in 13.8 s).

## §1 Executive summary

The chairops/pos-ingest pipeline now ingests all 3 StarThing file types (daily summary · cash event · coin event) in a single drop, with English-header support, BigInt overflow handling, one-click branch creation, historical-safe chair-move logic, and a bulk-write commit path that fits inside Vercel Hobby's 300-s function ceiling. Every CEO step verified live today on production.

26 commits closed every known issue surfaced during the 4-hour CEO debug session. No P0 findings remain; this audit logs 4 P1 and 6 P2 follow-ups for a future sprint.

## §2 Scope

### IN

- `app/(admin)/chairops/(office)/pos-ingest/page.tsx` (landing · type pill + 3 cards + multi-uploader + imports table + undo banner)
- `app/(admin)/chairops/(office)/pos-ingest/i/[id]/page.tsx` (preview · diff table + commit card + unknown-branches card + re-resolve button)
- `app/(admin)/chairops/(office)/pos-ingest/_components/*` (multi-uploader · latest-cards · undo-import-button)
- `app/(admin)/chairops/(office)/pos-ingest/i/[id]/{commit-card,diff-table,unknown-branches-card,reresolve-button}.tsx`
- `app/(admin)/chairops/pos-ingest/{actions,multi-actions}.ts`
- `lib/chairops/pos-ingest/{starthing-events,starthing-xlsx,event-diff}.ts`
- `prisma/schema.prisma` (BigInt + ChairopsPos*Event tables)
- `scripts/{probe-coin-event-column-type,probe-import-diff,reresolve-import-diff,finalize-daily-import,test-pos-dedup-overlap}.ts`

### OUT

- ChairopsBranch CRUD (touched only via addBranchFromStarThing)
- Reconcile / drift engine (consumer of pos data · not in scope)
- Cash collection / deposit flows (parallel feature)

### DEFERRED-HW

- None. All features ship today on existing Vercel + Supabase + Prisma.

## §3 Sitemap

| Page | Who | Why | KPI |
|---|---|---|---|
| `/chairops/pos-ingest` | OFFICE+ | upload + monitor imports | latest data freshness · uncommitted count |
| `/chairops/pos-ingest/i/[id]` | OFFICE+ | diff preview + commit | rows accepted · time-to-commit · 0 unknown branches |
| `/chairops/pos-ingest/i/[id]?committed=<id>` | OFFICE+ | undo window (60 min) | undo click rate |

## §4 Token compliance (post claude-design polish in dad32f7)

- ✅ All Thai labels: no uppercase, no tracking-wider
- ✅ Caption floor 11px enforced
- ✅ Numbers tabular-nums on KPI cards
- ✅ Color reservation: type pill cash=emerald · coin=amber · daily=sky · unknown=zinc · BigInt warn=rose
- ✅ Sticky thead `top-0 z-20 bg-muted` · no translucent bg

## §5 Persona findings (lean · 8 inlined)

### BA · business analyst

**§summary**
- 3-file simultaneous upload is the daily workflow now · dedup makes overlap re-upload safe
- Add-branch flow correctly gated by explicit CEO click (no auto-create)
- Historical chair-move preservation respects maid current view

**§concerns**
- **P1**: 12 storeNames in this morning's upload had ZERO row data (StarThing aggregate-only entries) · they linger in unknownBranches list forever. UX: add "ignore this branch · zero rows" button to dismiss without creating.
- **P2**: undo window is 60 min · audit log records who undid but recovery doesn't notify upstream consumers (reports may have shown stale data for the window)

### SA · solution architect

**§summary**
- BigInt on coinAdded/coinMeter handles StarThing's unsigned-32-bit reality
- Snake-case `@@map` table names matched correctly in all 4 SQL/probe sites after 01c9db0 fix
- Drift recompute decoupled from commit response · fire-and-forget pattern

**§concerns**
- **P1**: cashAdded/cashMeter still Decimal(12, 2) · works for now but StarThing could overflow that too (10^10). Probe + matching migration recommended within 30 days.
- **P2**: No row-level audit log on PosDaily anymore (dropped for perf). diffSummary JSON has it but JSON doesn't index well. If forensic review needed, recovery via `imp.diffSummary->rows[*]` is O(N) scan.

### BE · backend / perf

**§summary**
- Bulk-write round 2 brought 1012-row commit from 300 s timeout → 13.8 s
- Promise.allSettled on drift recompute leverages Node serverless idle keep-alive
- Per-file commit calls (cash and coin separate POSTs) bypass Vercel 1 MB body cap

**§concerns**
- **P1**: `chairopsChair.update` on live moves still per-row inside Promise.all · if 200+ chairs move on one commit this is 200 parallel DB connections. Connection pool exhaustion risk on prod Supabase (default 60 connections).
- **P2**: information_schema probe in event-diff.ts on every preview call is wasteful after migration applied. Add a one-shot env flag or feature flag to skip after confirmed.

### QA · test engineer

**§summary**
- Deterministic dedup test (scripts/test-pos-dedup-overlap.ts) passes — content-addressable hash works
- 4 recovery scripts in repo for future incidents (probe + reresolve + finalize + migrate)
- End-to-end CEO walkthrough completed today

**§concerns**
- **P1**: No Playwright e2e for the full upload→preview→commit flow. With this much UI state (preview → reresolve → add-branch → commit) regression risk is high.
- **P2**: Edge case untested: 2 imports with overlapping date+chair both pending commit. Second commit's existingDailyMap pre-load doesn't see first commit's writes (different tx). Result: createMany conflict on unique index? Need to verify behavior.

### UX · UI lens

**§summary**
- Multi-uploader dropzone copy clear · file-type pill scannable · dedup callout explicit
- Rose banner BIGINT migration self-suppresses after probe sees bigint
- Elapsed-seconds counter on commit button addresses "is it hung?" worry

**§concerns**
- **P2**: After clicking "Re-resolve preview" the toast tells you "rows patched X · new count Y", but the page would benefit from a transient highlight on the rows that flipped status (subtle yellow flash 1 s) so the operator sees WHICH rows resolved.

### OFC · office reconcile staff

**§summary**
- Workflow today: drag 3 files → 1-click migration if needed → click "เพิ่มสาขานี้" for unknown stores → commit
- Total time today after migration applied: ~3-5 min for full StarThing month-end batch

**§concerns**
- **P2**: No batch "เพิ่มทุกสาขาเลย" button. If the StarThing rebrand changes all 30 branch names overnight, 30 single clicks is slow. Add a "เพิ่มทั้งหมด N สาขา" footer button to UnknownBranchesCard when N ≤ 20.

### DEVIL · over-engineering check

**§summary**
- 26 commits is genuinely the work · no scope creep visible
- Recovery scripts left in repo are pragmatic · classifier blocked execution today but the scripts ARE the reference for future ops

**§concerns**
- **None**. Every commit traced to a real CEO-surfaced bug or explicit feature request. No speculative additions.

### SRE · site reliability

**§summary**
- maxDuration = 300 explicit on the route (no silent regression on future deploys)
- BIGINT migration safe-live (metadata-only ALTER)
- Read-only probes scriptable for ops verification

**§concerns**
- **P1**: No monitoring on the fire-and-forget `recomputeAllDrifts` chain. If it errors silently 100 times, no alert. Wrap in Sentry capture or push to an internal `chairops_job_log` table.

## §6 P0/P1/P2 summary

| Sev | Finding | Owner | Fix cost |
|---|---|---|---|
| **P0** | — none — | — | — |
| **P1** | Empty-row unknown branches lingering | UX/BA | 2 hr |
| **P1** | Cash Decimal could overflow same as coin | SA | 1 hr probe + 4 hr migration |
| **P1** | Per-chair update Promise.all could exhaust pool | BE | 2 hr (chunk batches of 25) |
| **P1** | No e2e test for upload→commit path | QA | 1 dev-day Playwright |
| **P1** | No alert on fire-and-forget drift errors | SRE | 1 hr Sentry wrap |
| **P2** | No row-level audit on PosDaily writes | SA | accept · diffSummary JSON suffices |
| **P2** | info_schema probe every preview wasteful | BE | feature flag · 30 min |
| **P2** | Overlapping pending commits race | QA | 1 hr investigation |
| **P2** | Re-resolve doesn't highlight flipped rows | UX | 30 min |
| **P2** | No batch add-branch button | OFC | 1 hr |
| **P2** | Undo doesn't notify report consumers | BA | accept · short window |

## §7 Locked decisions (this audit)

- **D-POS-1** (2026-06-01) · Default upload flow = multi-file via /chairops/pos-ingest dropzone. The single-file routes `/upload` and `/new` redirect to root. Legacy bookmarks supported.
- **D-POS-2** (2026-06-01) · Coin column type = BIGINT. Migration applied via Supabase SQL Editor by CEO. Probe verification mandatory before any future overflow analysis.
- **D-POS-3** (2026-06-01) · pos_ingest commitImport NEVER updates chair.branchId for rows whose bizDate < chair.lastMoveAt. Historical backfills are log-only.
- **D-POS-4** (2026-06-01) · Drift recompute is fire-and-forget · commit returns before drift catches up · reports tolerate ~10-30 s eventual consistency.
- **D-POS-5** (2026-06-01) · Branch creation from preview is explicit (per click) · NEVER batched as side-effect of upload (preserves `[[pool-csv-import-must-diff-before-write]]` intent).

## §8 Recommended next steps

1. **Within this sprint** — P1 #2 (cash decimal probe). Cheap to check, expensive if it bites.
2. **Within 2 sprints** — P1 #1 (empty-row unknown stores UX) + P1 #4 (Playwright e2e harness).
3. **Backlog** — P2 items as polish.

## §9 Sign-off

| Persona | Status | Notes |
|---|---|---|
| BA | ✅ PASS | 2 P1/P2 logged |
| SA | ✅ PASS | 1 P1 (cash decimal) |
| BE | ✅ PASS | 1 P1 (pool exhaustion bound) |
| QA | 🟡 CONDITIONAL | e2e test gap acknowledged |
| UX | ✅ PASS | post-polish on-token |
| OFC | ✅ PASS | workflow confirmed live |
| DEVIL | ✅ PASS | no overengineering |
| SRE | 🟡 CONDITIONAL | drift error monitoring gap |

**0 BLOCKED · 2 CONDITIONAL · production-ready as-is for the next 2 sprints.**

## §10 References

- Memory: `[[chairops-pos-multifile-shipped-2026-06-01]]` · `[[chairops-only-session-scope-2026-05-27]]` · `[[chairops-starthing-3reports-validated-2026-05-28]]` · `[[chairops-maid-one-per-branch-collect-only]]` · `[[pool-csv-import-must-diff-before-write]]`
- Commits: 03084e7..dad32f7 (26 commits, 2026-06-01)
- Tokens SSoT: `~/.claude/skills/auditbigteam/tokens.md`
