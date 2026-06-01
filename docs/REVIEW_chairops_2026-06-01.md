# REVIEW · ChairOps massage-chair business · 2026-06-01

> Comprehensive review of the entire ChairOps module using 6 specialist
> skill lenses (after installing 230 finance + engineering skills today).
> Scope: 22 Prisma tables, 52 page.tsx files, ~10 server-action modules.
>
> Methodology lenses applied (each skill's SKILL.md read + checklist run):
> `/reconciliation` `/data-quality` `/account-maintenance` `/books-and-records`
> `/observability-designer` `/financial-analyst`

## §0 Snapshot

- 30 active branches · ~91 chairs deployed today
- 3-way data sources: StarThing daily summary · StarThing cash event · StarThing coin event (all 3 live in prod after this morning's work)
- Reconcile flow: POS expected → maid collect → maid deposit → drift cache → exec dashboard
- 22 ChairopsXxx Prisma tables · 52 admin pages · 1 maid LIFF Mini App
- Latest CEO event today: dashboard showed +59,352 vs −59,352 contradiction · audit found dual sign convention (drift-engine positive=shortage, kit cell negative=shortage)

---

## §1 `/reconciliation` lens · 3-way reconciliation discipline

**SKILL prompt summary:** three-way recon across advisor/custodian/clearing — break identification, aging, escalation, tolerance thresholds.

**ChairOps 3-way equivalent:**

| Lane | Source | Where it lives |
|---|---|---|
| 🅐 Custodian-of-record | StarThing POS (vendor system) | `ChairopsPosDaily` + `ChairopsBranchDailyRevenue` |
| 🅑 Operations | Maid count (handheld) | `ChairopsCashCollection.countedAmount` |
| 🅒 Bank | Bank deposit slip | `ChairopsCashDeposit.depositedAmount + bankFee` |

**Recon points:**
- 🅐 vs 🅑 — POS expected vs maid counted (per-chair · per-collection)
- 🅑 vs 🅒 — maid counted vs maid deposited (per-collection · maid keeps any tip diff)
- 🅐 vs 🅒 — POS expected vs bank deposit (lifetime · this is what drives `ChairopsDrift`)

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P1 | **Drift cache only tracks 🅐 vs 🅒** — 🅐↔🅑 and 🅑↔🅒 breaks vanish into per-collection records · no aggregated view. CEO can't see "this maid consistently under-counts." | Add ChairopsCollectionDiff cache · daily refresh |
| P1 | **No tolerance threshold config** — every ฿1 mismatch triggers drift. SKILL recommends position-tolerance ฿X + percentage Y%. | Add ChairopsReconcileConfig table with per-tone tolerances |
| P2 | **No break aging visible in dashboard** — `ChairopsDrift.driftSince` exists but only shown on alert page · not in main 30-branch table | Add "อายุ DRIFT" column to leaderboard |
| P2 | **No regulatory exam prep workflow** — recon evidence (proof of POS file + bank slip + maid count) lives in 3 places · no "show me everything for branch X day Y" handle | Add /chairops/reconcile/audit-pack/[branchId]?date= |

### Top break right now (per probe)
| Branch | POS | Deposit | Diff | Hypothesis |
|---|---|---|---|---|
| centralโคราช(ธอส) | 22,761 | 0 | +22,761 (shortage) | Branch in DB but no maid collection cycle ever ran |
| mpark | 18,880 | 0 | +18,880 (shortage) | Same — new branch via add-branch flow today, no maid wired up |
| centralโคราช(บริจาคเลือด) | 17,711 | 0 | +17,711 | Same |

→ These are **NOT real shortages** · they're "branch onboarding gap" · maid assignment never linked.

---

## §2 `/data-quality` lens · Golden source + lineage + validation

**SKILL prompt summary:** golden-source designation, validation rules, data lineage, exception management, scorecard.

### Golden-source designation
| Concept | Today's golden source | Quality |
|---|---|---|
| **Chair location** | `ChairopsChair.branchId` (mutated by chair-move) | ⚠️ TWO writers: pos_ingest + equipment XLSX. Historical-safe fix today only blocks pos_ingest's writes to historical date · equipment XLSX still overrides freely |
| **Daily POS revenue** | `ChairopsPosDaily` (per-chair-per-day) AND `ChairopsBranchDailyRevenue` (per-branch-per-day aggregate) | ⚠️ DOUBLE truth · aggregate is derived but written separately · can drift |
| **Cash events** | `ChairopsPosCashEvent` (timestamped) | ✅ single source · rowHash dedup |
| **Coin events** | `ChairopsPosCoinEvent` | ✅ single source |
| **Maid count** | `ChairopsCashCollection.countedAmount` | ✅ single source |
| **Bank deposit** | `ChairopsCashDeposit.depositedAmount + bankFee` | ✅ single source |
| **Lifetime drift** | `ChairopsDrift.driftAmount` (cache) | ⚠️ cache invalidation hand-wired · stale if recomputeAllDrifts errors silently (P1 today's audit) |

### Data lineage

```
StarThing XLSX (3 files)
   │
   ├─ daily summary    ─► parser ─► [diffSummary JSON in PosImport] ─► commit ─►
   │                                                                  │
   │                                                          ChairopsPosDaily (per-chair-per-day)
   │                                                          ChairopsBranchDailyRevenue (per-branch-per-day)
   │
   ├─ cash event       ─► parser ─► row-hash dedup ─► ChairopsPosCashEvent
   │
   └─ coin event       ─► parser ─► row-hash dedup ─► ChairopsPosCoinEvent
                                                                  │
                                                                  ▼
                                          ┌─── drift-engine.ts (lifetime POS - deposit) ───┐
                                          │                                                  │
                          ChairopsCashCollection                            ChairopsCashDeposit
                          (maid handheld)                                   (bank slip)
                                          │                                                  │
                                          ▼                                                  ▼
                                     ChairopsDrift cache ──► dashboard KPI + leaderboard
```

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P0 | **Sign convention mismatch documented but not enforced** — drift-engine positive=shortage · ShortageDriftCell negative=shortage · every consumer hand-flips. One missed flip = visual lie to CEO. | Add a single shared `formatDriftForDisplay()` util · lint rule rejecting raw `driftAmount` in JSX |
| P1 | **No validation rule catalog** — parsing rules live in starthing-xlsx.ts COLUMN_ALIASES and actions.ts HEADER_ALIASES (2 places) · can drift. | Consolidate into `lib/chairops/validation/starthing-rules.ts` · single source |
| P1 | **No data quality scorecard** — current pos-ingest landing shows fresh/stale/rotten by upload age · but no row-level quality metric (% rows resolved · % unknown branch · % bad date) | Add 4th card "ข้อมูลที่อ่านได้สมบูรณ์" with rolling 7-day % |
| P2 | **diffSummary JSON in ChairopsPosImport is the only audit of row-level outcomes** — JSON not indexed · O(N) scan to investigate one row. | Either add row-level audit log back OR add jsonb indexes on common paths |

---

## §3 `/account-maintenance` lens · Sign convention + lifecycle

**SKILL prompt summary:** account lifecycle, sign-convention discipline, tax-lot methods, beneficiary designations.

### ChairOps "account" = branch + chair + maid triad

| Lifecycle event | Today's handling |
|---|---|
| **Open new branch** | Manual via /chairops/branches/new OR auto via `addBranchFromStarThing` (today) |
| **Move chair between branches** | `ChairopsChairMove` ledger · pos_ingest writes historical, equipment XLSX writes current |
| **Assign maid → branch** | `ChairopsUser.primaryBranchId` · 1:1 per memory `[[chairops-maid-one-per-branch-collect-only]]` |
| **Close branch** | `ChairopsBranch.isActive = false` · NO cascade to chairs/maids today |
| **Delete chair** | Soft-delete via `isActive = false` · NO write-off of in-flight drift |

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P0 | **Sign convention IS the active risk** (today's CEO incident) — already documented in `[[chairops-drift-sign-convention]]` but no automated guard | Add lint/type-system guard · custom branded type `Drift` distinct from `number` |
| P1 | **Closing a branch leaves dangling chairs + drift** — `ChairopsBranch.isActive = false` doesn't migrate chairs · drift cache keeps showing the closed branch | Add `chairops_branch.archive()` action: reassign or delete chairs, write-off drift, audit log |
| P1 | **Maid 1:1 branch enforcement only in memory** — schema allows N:N via ChairopsUser.primaryBranchId being mutable · no historical "who collected when" beyond ChairopsCashCollection.maidId | Add maid-branch history table OR audit log policy enforcing manual review |
| P2 | **No branch close ceremony** — no equivalent of "final cash count · settle all pending · archive" workflow | Build `/chairops/branches/[slug]/close` wizard later |

---

## §4 `/books-and-records` lens · Audit trail completeness

**SKILL prompt summary:** SEC 17a-3/17a-4 · WORM · electronic communications archiving · retention schedule · examiner-ready.

### ChairOps audit trail today

| Surface | Writer | Retention |
|---|---|---|
| `ChairopsAuditLog` | ALL writes (mostly) | forever |
| `ChairopsPosImport.diffSummary` | per-import row JSON | forever |
| `ChairopsChairMove` | every chair location change | forever |
| Vercel logs | server errors | 30 days (free) |
| Sentry breadcrumbs | client + server errors | per plan |

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P1 | **Per-row PosDaily audit dropped 2026-06-01** (perf round 1) — diffSummary JSON has the data but isn't indexable. SEC-equivalent rule = books-and-records reconstructable in <72h. | Re-add minimal audit row (action + entityId + oldHash + newHash, no body) OR add `jsonb_path_ops` GIN index on `chairopsPosImport.diffSummary` |
| P1 | **Fire-and-forget drift errors only land in Vercel console** (today's P1 fix) — Sentry picks it up but ops query path is unclear | Add a `chairops_background_job_failures` table OR formalize Sentry-tag conventions in CLAUDE.md |
| P2 | **WhatsApp/LINE archiving NOT in place for maid communications** — LINE chat for chair-move requests / damage reports is ephemeral. CEO mental model includes "maid told me by LINE" but record is in maid's phone | Out-of-scope for ChairOps · belongs in Inbox module |
| P2 | **Examiner-ready bundle missing** — if CEO had to produce "all evidence for branch X month Y" today, would have to query 6 tables manually | Build /chairops/reports/audit-bundle export later |

---

## §5 `/observability-designer` lens · Drift alert + SLO

**SKILL prompt summary:** golden-signals · SLI/SLO · alert noise reduction · runbook discipline.

### Today's signals

| Signal | Type | Wired? |
|---|---|---|
| **Drift > 0 for > 24h** | alert | ✅ `chairops_alert_event.SHORTAGE_CRITICAL` |
| **No collection in N days** | alert | ✅ `MISSED_COLLECTION` |
| **POS upload age > N days** | dashboard color · not alert | ⚠️ visual only |
| **drift recompute error** | console.error + audit log (today's P1 fix) | ⚠️ no rolled-up alert |
| **commitImport latency > 60s** | not tracked | ❌ |
| **dedup ratio per upload** | shown in preview · not aggregated | ⚠️ |

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P1 | **Drift alert single-threshold** — 24h trigger fires for ฿100 AND ฿100,000 same way · alert fatigue inevitable | Add per-tone thresholds (24h+>฿5k = WARN, 48h+>฿20k = CRITICAL) · per SKILL guidance |
| P1 | **No SLO for ingest pipeline** — "X% of StarThing uploads commit in <60s · 95th percentile <120s" undefined | Define SLO + add Vercel timing instrumentation |
| P2 | **Alert routing single-channel (LINE only)** — when CEO is on plane no fallback. SKILL recommends multi-channel + escalation tree | Add SMS fallback OR Telegram secondary |
| P2 | **No runbook artifact** for "drift spikes overnight" · CEO had to wake up and ask | Create docs/runbooks/chairops-drift-spike.md |

---

## §6 `/financial-analyst` lens · Cash-flow + variance

**SKILL prompt summary:** financial ratio analysis · variance · forecast.

### Snapshot (from this morning's data)

- Branches with revenue last 10 days: 30 active · revenue shown in dashboard 86,200฿ over 10 days = ~฿8,620/day average across ALL branches combined
- 3 zombie branches (centralโคราช ธอส, mpark, centralโคราช บริจาคเลือด): ฿59,352 stuck in POS-no-deposit limbo

### Findings

| Sev | Finding | Detail |
|---|---|---|
| P1 | **No variance vs budget** — there's `monthlyRent + monthlyUtility + monthlyStaff` on ChairopsBranch (CostCtrl-compatible) but no actual-vs-budget panel for ops | Add a Budget Variance card to /chairops/reports |
| P1 | **No revenue trend chart per branch** — leaderboard shows lifetime drift · not 30-day MoM trend per branch | Add sparkbar on each leaderboard row (kit primitive `sparkbar.tsx` exists, unused) |
| P2 | **No DCF / breakeven per branch** — opening criterion documented in audit as "≥฿X/day revenue 6 weeks" but not computed | Build "ROI panel" with payback months |
| P2 | **No cohort analysis** — branches opened in March 2026 vs April vs May = different aging curves · not tracked | Defer · needs >6 months data |

---

## §7 Cross-cutting findings (skill-overlap)

| Sev | Finding | Affects skills |
|---|---|---|
| 🔴 P0 | **Sign convention as `Drift` branded type** — eliminate raw `number` in JSX | reconciliation + account-maintenance + data-quality |
| 🟡 P1 | **Consolidate StarThing parsing rules** into one source-of-truth file | data-quality + reconciliation |
| 🟡 P1 | **Per-branch budget variance panel** | financial-analyst + observability |
| 🟡 P1 | **Recon evidence bundle export** (branch + date → PDF/CSV) | books-and-records + reconciliation |
| 🟡 P1 | **Per-tone drift thresholds + multi-channel alert** | observability + reconciliation |
| 🟡 P1 | **Branch close ceremony workflow** | account-maintenance |
| 🟡 P1 | **Re-add minimal PosDaily audit row (oldHash/newHash)** | books-and-records |

## §8 Priority for next sprint

**Pick 3 of these 7 for next sprint** (CEO chooses):

1. **Sign convention branded type** (1 dev-day · eliminates the +59,352/-59,352 class of bug forever)
2. **Per-tone drift thresholds + multi-channel alert** (2 dev-days · reduces alert fatigue + missed escalations)
3. **Per-branch budget variance panel** (2 dev-days · unlocks CostCtrl ↔ ChairOps integration)
4. **Recon evidence bundle export** (3 dev-days · examiner-ready + audit-friendly)
5. **Branch close ceremony** (2 dev-days · prevents zombie branches like the 12 still unresolved today)
6. **StarThing parsing rules consolidation** (1 dev-day · pure refactor, lower risk)
7. **Re-add minimal audit row** (1 dev-day · partial revert of perf round 1 with smaller payload)

## §9 What the 230 skills DIDN'T catch (honest)

- **Maid mobile UX** — finance skills don't cover field operations. /staff persona from auditbigteam still wins here
- **LINE/LIFF auth quirks** — none of these skills know about iOS WKWebView cookie partitioning
- **Thai banking quirks** — bankFee per transfer, weekend cut-offs · skills assume US clearing semantics
- **Massage-chair-specific** — coin meter overflow, chair physical move, maid 1:1 rule · all ChairOps-native, no skill covers them

So: skills upgrade the GENERIC accounting + ops + observability layer · ChairOps-specific patterns still need first-party memory + wiki.

## §10 References

- Source memory:
  - `[[chairops-drift-sign-convention]]` (today)
  - `[[chairops-pos-multifile-shipped-2026-06-01]]`
  - `[[chairops-massage-chair-business]]`
  - `[[chairops-no-cumulative-shortage]]`
  - `[[chairops-maid-one-per-branch-collect-only]]`
  - `[[chairops-only-session-scope-2026-05-27]]`
- Source code surveyed:
  - 22 ChairopsXxx Prisma models
  - 52 page.tsx in `app/(admin)/chairops/`
  - 6 server-action modules in `app/(admin)/chairops/**/actions.ts`
  - 4 lib modules in `lib/chairops/`
- Skill SKILL.md files read:
  - finance_skills/plugins/client-operations/skills/reconciliation
  - finance_skills/plugins/data-integration/skills/data-quality
  - finance_skills/plugins/client-operations/skills/account-maintenance
  - finance_skills/plugins/compliance/skills/books-and-records
  - claude-skills-rezvani/engineering/skills/observability-designer
  - claude-skills-rezvani/finance/skills/financial-analyst
- Live data probed: `scripts/probe-drift-state.ts` (read-only · cleaned via /goal scripts today)
