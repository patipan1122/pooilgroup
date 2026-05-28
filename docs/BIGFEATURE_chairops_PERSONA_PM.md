# BIGFEATURE · ChairOps · Persona PM

> **Persona:** Project Manager · **Run:** 2026-05-27 · **Mode:** Full ship (`/goal ทำทั้งหมดให้สมบูรณ์`)
> **Inputs:** `docs/BIGFEATURE_chairops_CONTEXT.md` · `docs/BIGFEATURE_chairops_GOAL.md` · `docs/CHAIROPS_WAVE_PLAN_2026-05-27.md` · `docs/AUDIT_chairops_2026-05-25.md`

---

## 1 · Audit-risk re-validation (vs actual code state)

| # | Audit risk | Status now | Evidence |
|---|---|---|---|
| 1 | Drift = lifetime-sum (BR2 zero-tolerance theatre) | **STILL OPEN** | `lib/chairops/reconcile/drift-engine.ts:48-66` aggregates `chairopsPosDaily` + `chairopsCashCollection` **without `where` date bounds** → lifetime sum. Window/period model not implemented. |
| 2 | 3 ChairOps crons not in `vercel.json` | **CLOSED** | `vercel.json:19-21` registers all 3 (recompute-drifts · sop-check · ceo-digest). Wave plan W0.1 row #2 is **stale** — delete it. |
| 3 | Module entitlement gate missing | **CLOSED at root** · **needs nested audit** | `app/(admin)/chairops/layout.tsx:25-29` correctly calls `isModuleDisabled('chairops')` + `userHasModuleAccess`. 11 nested layouts inherit (Next.js cascades), but Phase 3 personas should grep each for any independent `requireSession` bypass. |
| 4 | Auto-bootstrap admin in `getSession` | **CLOSED** | `lib/chairops/auth/session.ts:72-100` explicitly removed the auto-bootstrap; now logs `access.denied_no_chairops_user` and returns null. Comment marks it "Wave-0 fix · audit Phase-1 BE/SA flagged". Wave plan W0.1 row #4 is **stale**. |
| 5 | LINE Notify EOL | **STILL OPEN** | `lib/chairops/line/notify.ts:28` posts to `https://notify-api.line.me/api/notify`. 5 env-keyed tokens. Used by `lib/chairops/reconcile/alerts.ts:6`. Sunset 2025-03-31 already passed in our timeline (today = 2026-05-27) — **possibly dead today**. |
| 6 | `loadUserModules` admin array missing chairops/clawfleet/playland | **OPEN** | Per context doc line 25 — Pool-wide one-line fix, must ship Wave 0. |

**Net:** Wave plan W0.1 lists 5 risks but **2 are already closed** (cron registry · auto-bootstrap). Real Wave-0 risk work = 3 items (drift window · LINE migration · module-array bug). This **shrinks Wave 0 by ~1 dev-day**.

---

## 2 · Scope (per wave)

**Wave 0 (Foundation Fix · revised):** IN — drift window refactor + `ChairopsBranchDailyRevenue` table + StarThing XLSX parser + diff-preview upload UI + branch cost fields + `loadUserModules` bug-6 fix + LINE Notify stub-out (defer migration to W1). OUT — LINE OA, period-close, vendor bills, audit polish.

**Wave 1 (Maid + Office daily flow):** IN — LINE OA channel + LIFF Mini App + 4 maid PWA flows (collect/cleanliness/damage/supply) + office 30×4 grid + LINE Notify retirement + AES-256-GCM token table. OUT — vendor bills, period-close, accounting export.

**Wave 2 (Finance):** IN — `ChairopsVendorBill` + Gmail AI parser cron + `ChairopsPeriod` lifecycle + adjustment workflow + BC/Express CSV export + `ChairopsCOAMap` + `PeriodReopenLog`. OUT — leaderboard polish, audit-of-auditors.

**Wave 3 (Polish):** IN — 11-filter audit page + damage SLA cron + spare-parts ledger + leaderboard + LINE OA push templates. OUT — anything not in earlier waves.

**Cross-wave deps:** W1 LINE OA blocks W3 push templates · W2 `ChairopsPeriod` blocks W3 leaderboard "month-to-date" tiles · W0 `BranchDailyRevenue` blocks W3 leaderboard sparkline · W0 module bug-6 fix unblocks **every** admin-tier user seeing ChairOps in nav today.

---

## 3 · Effort estimate

| Wave | Plan claim | PM revised | Δ | Reasoning |
|---|---|---|---|---|
| W0 | 3-4 d | **3-4 d** | 0 | -1d (2 closed risks) +1d (real drift refactor: schema migration + backfill + tests) |
| W1 | 5-7 d | **7-9 d** | +2 | LINE OA business account setup is external 1-3 d wall-clock · LIFF Mini App x 4 flows + offline outbox IndexedDB is undercosted at 5-7 |
| W2 | 4-6 d | **6-8 d** | +2 | Period-close + adjustment workflow + BC/Express CSV + COA mapping is ~3 d alone · Gmail AI ingest cron + R2 + Claude API + manual-approval UI = 3-5 d |
| W3 | 3-4 d | **3-4 d** | 0 | Polish realistic |
| **Total** | **15-21 d** | **19-25 d** | **+4** | Plus 2-3 d unscoped: real-device QA · CEO sponsor session · pilot ramp-up · doc/training |

**CEO 3-4 week claim:** 3 weeks = 15 working days · 4 weeks = 20. Realistic budget is **20-25 working days = 4-5 weeks** for full ship with one engineer. CEO's 3-4 week claim is **optimistic by ~1 week**. Recommend communicating 5 weeks with hard gates at end of each wave.

---

## 4 · Risk register (sorted by severity)

| ID | Risk | Likelihood × Impact | Mitigation |
|---|---|---|---|
| **R-NEW-1** | Drift refactor changes existing alerts retroactively → CEO sees status flip on day-0 | H × H | Dual-write 1 wk · diff-report shown before cutover · backfill from `bizDate` per `[[chairops-no-cumulative-shortage]]` semantics |
| **R-NEW-2** | LINE Notify already dead (sunset was 2025-03-31) → BR2 alerts silent today | H × H | **Verify TODAY** — curl notify-api.line.me; if 401 → escalate W1 LINE OA to Wave-0.5 emergency |
| **R-NEW-3** | LINE OA business account approval delay (1-3 d external wall-clock) | M × M | CEO starts approval **NOW**, parallel to W0 engineering |
| **R-NEW-4** | Gmail AI auto-parser cost runaway · Claude API on 100+ bills/month | M × M | Token-budget guard + monthly cap env · per `[[ceo-prefers-manual-ai-triggers]]` keep manual approval |
| **R-NEW-5** | StarThing XLSX schema drift between months · CEO uploads with new columns | M × M | Diff-preview must show **column-set diff** not just row diff per `[[pool-csv-import-must-diff-before-write]]` |
| **R-NEW-6** | DEVIL hard-fail at audit (60-70% overengineering) — CEO chose Q4=a anyway | M × M | Build wave-gate exit criteria · stop after each wave to validate against real user before next |
| **R-NEW-7** | Pilot maid = 0 actual users until W1 ends · spec built blind | M × M | Insert real-device QA + pilot-branch onboarding in W1 exit criteria |
| **R-NEW-8** | `loadUserModules` bug-6 fix touches shared Pool file · regresses other modules | L × H | Single-line change · add Vitest covering admin-tier array · CI must pass on Pool-wide build |

---

## 5 · Critical path + SPoFs

```
W0 drift refactor ──► W0 BranchDailyRevenue ──► W3 leaderboard
W0 module-bug-6 ────► (unblocks admin-tier seeing module in nav today · do FIRST)
CEO LINE OA approval (external) ──► W1 LIFF Mini App ──► W3 push templates
W1 LINE Notify retirement ──► R-NEW-2 BR2 alerts working
W2 ChairopsPeriod lifecycle ──► W3 month-to-date KPI tiles
```

**Single points of failure:**
1. **LINE OA approval** — external dependency, no eng work-around. CEO must start day-1.
2. **CEO sponsor for pilot branch** — W1 needs 1 maid + 1 office + 5-day commitment. If not lined up, W1 ships untested.
3. **Engineer bandwidth** — solo engineer for 5 weeks · one sick day = wave slip. Plan no concurrent module work per `[[chairops-only-session-scope-2026-05-27]]`.

---

## 6 · Rollback plan (per wave)

- **W0:** Revert single PR; new table `ChairopsBranchDailyRevenue` is additive (no FK on existing rows) — `DROP TABLE` safe. Cost fields are nullable additions — safe. Drift refactor: keep old `lifetime` query as fallback flag `CHAIROPS_DRIFT_MODE=legacy` for first week.
- **W1:** Feature flag `CHAIROPS_LINE_OA=on`. Off = falls back to LINE Notify (assuming still alive). LIFF Mini App routes are new paths · safe to leave dark.
- **W2:** Vendor bills + period-close are new surfaces · disable via `MODULES_DISABLED=chairops-bills` env or remove nav entry. Accounting export is read-only — no rollback needed.
- **W3:** Pure additive · revert PR.

**Hard rule:** No destructive schema changes without `[[migration-repair-without-real-apply-trap]]` discipline. Never `prisma db push --accept-data-loss`.

---

## 7 · What's missing from wave plan

1. **No "verify TODAY" step for LINE Notify** — could already be dead, would make BR2 immediate-alert promise hollow on existing prod.
2. **No CEO LINE OA approval scheduled in W0** — must start day-1, 1-3 d external wall-clock.
3. **No real-device QA budget** — `[[recruit-canvas-parity-2026-05-22]]` learned 3-device test catches 80% of mobile bugs.
4. **No data-migration plan for existing `ChairopsPosDaily` → `BranchDailyRevenue`** — does W0 backfill from existing rows, or only forward-looking?
5. **No `companyId` consideration** — audit D-NEW-7 said 10 new tables need `orgId NOT NULL`; FIN persona wanted `companyId` for VAT mark too.
6. **No CronRun audit table** — audit Phase 2 BA listed it; helps debug 3 crons silently failing.
7. **D-NEW-A through D-NEW-G open decisions** — wave plan defaults them but CEO never signed off explicitly.

---

## 8 · Memory conflicts with proposed work

- `[[chairops-reconcile-window-noon-to-noon]]` says **window-based by noon-to-noon** but `[[chairops-starthing-xlsx-schema-2026-05-27]]` (per context) says XLSX has **no timestamp** → wave plan correctly degrades to daily-window but **memory should be updated** to reflect "daily-window until POS API arrives".
- `[[chairops-maid-schedule-irregular]]` favors cumulative-drift tracker like CashHub, but `[[chairops-no-cumulative-shortage]]` says zero-tolerance immediate alert. Both reconcile via "drift ≥ 0 with daily aging threshold". Code today (`drift-engine.ts:111-123`) does this correctly via `shortageAgeHoursToAlert: 24`.
- `[[chairops-only-session-scope-2026-05-27]]` says don't touch other modules · W0 must touch `lib/auth/module-access.ts` for bug-6 — explicitly carved as exception in goal doc · OK but flag in commit message.

---

## 9 · Recommendations to CEO (go/no-go)

| Wave | Recommendation | Gate criteria |
|---|---|---|
| **W0** | **GO** — narrow scope, mostly closed risks, high value (XLSX upload + bug-6 unblocks daily use) | Build/typecheck clean · XLSX upload roundtrip works · drift refactor backfilled · 1-week dual-write before legacy removed |
| **W0.5** | **NEW GATE** — verify LINE Notify still alive · if dead, fast-track LINE OA setup into W0 | `curl notify-api.line.me/api/status` returns 200 · OR CEO has LINE OA channel ID + secret ready |
| **W1** | **GO if CEO sponsor + pilot branch + LINE OA secrets ready by W0 exit** · else HOLD | 1 maid 1 branch 5-day pilot · 0 LINE Notify calls by day 5 · office dashboard real-time |
| **W2** | **GO** — high CEO-value (accounting unblock) but DEVIL warns 5-7 d on speculation | First-month BC/Express import ≥ 95% rows · 1 vendor bill goes AI extract → CEO approve → PAID lifecycle |
| **W3** | **GO conditionally** — only if W1+W2 acceptance hit · else descope and ship MVP | Audit filters work · KPI mobile-responsive · sticky thead correct per `[[sticky-thead-pattern]]` |

**Realistic timeline communicated to CEO:** **5 weeks** (not 3-4) for full ship · with hard gates at end of W0/W1/W2 where CEO can stop and validate before sinking next investment.

---

**END · PM persona output · ~780 words**
