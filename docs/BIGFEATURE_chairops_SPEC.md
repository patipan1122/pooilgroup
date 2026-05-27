# BIGFEATURE · ChairOps · Phase 4 Consolidated SPEC

> **Created:** 2026-05-27 · Run #1 of /bigfeature
> **Synthesizer:** Phase 4 agent over 12 personas + goal lock + wave plan
> **Output type:** Implementation spec — Wave 0 ready-to-execute
> **CEO mode:** /goal "ทำทั้งหมดให้สมบูรณ์" Full ship · wave-by-wave with sign-off gates
> **One-line verdict:** GO on Wave 0 unconditionally · CONDITIONAL on Wave 1-3 (see §10)

---

## 1 · Top 10 findings (sorted by leverage)

| # | Finding | Severity | Source |
|---|---|---|---|
| **1** | **`loadUserModules()` admin allowlist is missing `chairops · clawfleet · playland`** — three slugs exist in the `ModuleSlug` union (`lib/modules.ts:62`) but the admin-tier early return at `lib/auth/module-access.ts:30` and the non-admin filter at `:43-49` only check 5 of 8 slugs. **Every admin-tier user is invisibly blocked from 3 paid modules today.** Single-line fix · Pool-wide blast radius. | **P0 RED** | SA · PM · DevOps |
| **2** | **Zero `orgId` columns across all 16 ChairOps Prisma models** (verified grep). Module is silently single-tenant. Day a second org onboards → cross-tenant leak. SA flagged 8 unique constraints (`fileHash @@unique` etc.) that become cross-org collisions. | **P0 RED** | SA |
| **3** | **Drift engine is lifetime-sum, not window-based** — `lib/chairops/reconcile/drift-engine.ts:47-55` aggregates `chairopsPosDaily` + `chairopsCashCollection` **with no date `where`** → 6-month-old discrepancies fire alerts forever. Violates the "zero cumulative shortage" promise it advertises per `[[chairops-no-cumulative-shortage]]`. DEVIL: building 10 more tables on top of unverified money math = malpractice. | **P0 RED** | SA · DEVIL · QA |
| **4** | **DEVIL vote = DESCOPE.** Three claims justifying Full ship are weaker than they look: 30 LINE groups can be muted-to-1 channel without LIFF; accountant ROI assumes 95% which Thai PDF extract won't hit month-1 (predicted 60-75%); ChairOps competes for CEO mindshare with Playland device arrival. Recommend ChairOps Lite 6-day path (W0 + 1 broadcast channel + manual bills tab + CSV export). **CEO must consciously re-affirm Full ship after seeing this.** | RED | DEVIL |
| **5** | **Audit risk re-validation: 2 of original 5 are already CLOSED, not open.** Cron registry (`vercel.json:19-21`) and auto-bootstrap removal (`lib/chairops/auth/session.ts:72-100`) shipped pre-this-run. Wave plan W0.1 rows #2 and #4 are stale. Shrinks Wave 0 by ~1 dev-day. | INFO | PM · SA |
| **6** | **`ChairopsPosDaily.totalRevenue` is `Int`** (line 2952-2956) — StarThing `จ่ายเงินสด` carries cents in decimal. Money silently truncates on parse. Must widen to `Decimal(12,2)` in W0 schema migration AND fix the parser. | P0 | SA · QA |
| **7** | **LINE Notify EOL was 2025-03-31** — today is 2026-05-27. `lib/chairops/line/notify.ts:28` posts to `notify-api.line.me`. Probably dead today. BR2 immediate-alert promise is hollow. PM-R-NEW-2 demands `curl notify-api.line.me/api/status` verification **before** declaring drift engine "live." | P0 | PM · SA |
| **8** | **20+ uppercase-Thai violations + 5 translucent-sticky-bg violations** in chairops admin pages (UI persona §5). These violate brand memory `[[section-component-eyebrow-rootcause]]` and `[[sticky-bg-inherit-anti-pattern]]`. Cosmetically inherits the same "Section component" bug that took 80+ violations to clean Pool-wide in รอบ 46. | P1 | UI · QC |
| **9** | **`components/chairops/ui/{button,card,input,badge}.tsx` are 121 LOC of dead forks** — re-skin Pool primitives with zero added value. Delete in W0 cleanup; `_kit/` composites stay (KpiTile, ShortageDriftCell, etc. are legit). `LineNotifyToggle` needs full rewrite for LINE OA in W1. | P1 | UI |
| **10** | **No CronRun audit table** — 3 ChairOps crons run but `cron_runs` observability gap (per DevOps §4 + QC §5 + audit §10.3). Silent cron failures = silent ChairOps. Wave 0 wrap handlers in `runWithMonitor()` (helper already exists at `lib/cron/runner.ts`). | P1 | DevOps · QC · QA |

**Additional RED FLAGS from DEVIL not yet listed but on the record:**
- Drift math could say "all good" while cash leaks · pilot 5-days won't catch slow leak · need 3 branches × 14 days minimum.
- "Is ChairOps used or deployed?" — DEVIL demands `SELECT count(*) FROM ChairopsCashCollection WHERE createdAt > now() - interval '14 days'` before sinking 15-21 dev-day. If <50 rows, interview 2 maids first.
- Multi-floor branches: 42 sheet tabs vs 30 branches (per `[[chairops-sheet-42-tabs]]`) = ~12 multi-floor pairs. 1:1 maid-branch rule (`[[chairops-maid-one-per-branch-collect-only]]`) breaks here. Plan ignores.

---

## 2 · Wave 0 implementation playbook

> **Target dev-effort:** 4-5 days (vs 3-4 in plan) including drift refactor + backfill + tests.
> **Owner:** Claude (full-ship AI mode).
> **Gate criteria:** typecheck + lint + build clean · sample-XLSX roundtrip · 6 P0 bugs closed · CEO smoke-test pass · 7-day legacy drift dual-write before old-engine removal.

### 2.1 · `lib/auth/module-access.ts` — Pool-wide admin allowlist fix (Bug #1)

| Item | Detail |
|---|---|
| File | `lib/auth/module-access.ts` |
| Line | `:30` AND `:43-49` |
| Change | Replace literal slug array with `Set<ModuleSlug>` built from `Object.keys(MODULES)` (sourced from `lib/modules.ts:98`). Eliminates drift forever. |
| Acceptance | `loadUserModules(adminUser)` returns 8 slugs (cashhub · fuelos · docuflow · recruit · repairs · chairops · clawfleet · playland). Admin user navbar shows all 8 modules. Granted non-admin user with `module_name='chairops'` row passes through. |
| Effort | 30 min |
| Risk | Touches shared Pool file. Mitigation: add Vitest covering admin-tier array. CI Pool-wide build. |

### 2.2 · `prisma/schema.prisma` — model additions + orgId backfill (Bug #2, #6)

| Item | Detail |
|---|---|
| File | `prisma/schema.prisma:2771-3168` + new migration `supabase/migrations/<ts>_chairops_w0.sql` |
| Changes | (a) Add `orgId String` + `@@index([orgId])` to ALL 16 ChairOps models · (b) Convert global `@@unique` to `@@unique([orgId, ...])` on `ChairopsBranch.slug` · `ChairopsPosImport.fileHash` · `ChairopsCashCollection.imageHash` etc. · (c) Add 5 cost fields to `ChairopsBranch` (monthlyRent · monthlyUtility · monthlyStaff · monthlyOther · securityDeposit — all `Decimal(12,2)` nullable). (d) **NEW model `ChairopsBranchDailyRevenue`** (cashTotal · onlineTotal · otherTotal · grossTotal · paymentCount · coinInsertCount · roundCount · sourceImportId · `@@unique([orgId, branchId, bizDate])`). (e) Widen `ChairopsPosDaily.totalRevenue` → `grossTotal Decimal(12,2)` · `cash` → `cashTotal Decimal(12,2)` · `online` → `onlineTotal Decimal(12,2)` · rename `coin` → `coinInsertCount`. (f) Add `ChairopsAccessRequest` table (required by `session.ts:79-100` denial path). |
| Acceptance | `npx prisma migrate diff` output reviewed by hand · zero DROP statements except renames · psql apply succeeds on staging clone · `prisma generate` clean. Backfill: `UPDATE ChairopsBranch SET orgId = (SELECT id FROM organizations WHERE slug='pool')` for existing rows. |
| Effort | 6h (schema edit 1h · psql migration script 2h · backfill + verify 2h · prisma generate + type fix 1h) |
| Owner gate | **CEO must answer OQ-1 (securityDeposit visibility) before this lands.** Per Owner persona §What's NOT in plan — `securityDeposit` must be admin-tier-only column. Spec: add `@@index([orgId])` + at-rest field; expose via server action that filters by `isAdminTier(user.role)` only. |
| Memory cite | `[[migration-repair-without-real-apply-trap]]` · `[[pool-schema-drift-2026-05-21]]` · `[[reserve-quota-int-bigint-bug]]` |

### 2.3 · `lib/chairops/reconcile/drift-engine.ts` — daily-window rewrite (Bug #3)

| Item | Detail |
|---|---|
| File | `lib/chairops/reconcile/drift-engine.ts` |
| Current bug | Lines `:47-55` `aggregate` calls have no date filter. Drift = lifetime sum forever. Verified by direct read. |
| Rewrite plan | Replace `recomputeDriftForBranch(branchId)` to: (a) Read `branch.lastReconcileClosedAt` (new column on ChairopsBranch). (b) `posSince = SUM(BranchDailyRevenue.cashTotal where bizDate > lastClosedAt.date)`. (c) `depSince = SUM(CashCollection.depositedAmount where collectedAt > lastClosedAt)`. (d) `drift = posSince - depSince`. (e) Two-tier alerts: `drift > 0 AND ageHours > 24` → SHORTAGE CRITICAL; `daysSinceLastCollection > 1` → MISSED_COLLECTION WARN. (f) Persist via materialized view `chairops.mv_branch_open_drift` refreshed on COMMIT — drop `ChairopsDrift` lifetime-cache reliance. |
| Acceptance | All 13 BR1 test cases (per audit §7.4) pass · CEO sample XLSX with known shortage → alert fires within 24h · CEO sample XLSX with old (>30 days) discrepancy → does NOT re-fire alert (proves not lifetime-sum). |
| Safety net | Dual-write 7 days: feature-flag `CHAIROPS_DRIFT_MODE=legacy|window` (default legacy first day, flip to window day-2 after CEO compares diff report). |
| Effort | 1.5 d (rewrite 0.5d · backfill historical drift values 0.5d · BR1 test cases 0.5d) |
| Memory cite | `[[chairops-no-cumulative-shortage]]` · `[[chairops-starthing-xlsx-schema-2026-05-27]]` · `[[chairops-reconcile-window-noon-to-noon]]` (DEGRADED to daily-window) |

### 2.4 · `lib/chairops/auth/session.ts` — NO action (already fixed)

SA + PM verified `:72-100` already removed auto-bootstrap, logs `access.denied_no_chairops_user`, returns null. **Wave plan W0.1 row #4 is stale — skip.** B-SA-11 nit: `userId: null` in audit row loses subject identity; add `metadata.poolUserId` for forensics — 15 min change.

### 2.5 · `lib/chairops/pos-ingest/starthing-xlsx.ts` — NEW XLSX parser

| Item | Detail |
|---|---|
| File | `lib/chairops/pos-ingest/starthing-xlsx.ts` (NEW) |
| Implementation | Use `xlsx` (already in Pool deps per DevOps §intro). Read first sheet OR sheet named "ข้อมูลรายได้ (ตามกรอบเวลา)". Parse 20 cols per `[[chairops-starthing-xlsx-schema-2026-05-27]]`. Branch resolve: exact-string first → if no match, present user with fuzzy suggestions (Levenshtein ≤ 3) — **never auto-create**. Date parse: support Thai BE (2569) AND AD (2026) — both normalize to `bizDate`. Group by `(วันที่, branchId)` → sum `จ่ายเงินสด` + `ชำระเงินออนไลน์`. Return `{ newBranches[], dailyRows[], perChairRows[], errors[], columnSet[] }`. |
| Acceptance | XLSX-1 through XLSX-9 (QA §2 Wave 0) all pass. Idempotency: same file 2x → 2nd commit = 0 inserts (use SHA256 of file content as part of `(orgId, fileHash)` unique). Column-set diff exposed when CEO uploads file with new columns (DEVIL hidden-complexity #1). |
| Effort | 1 d |
| Memory cite | `[[pool-csv-import-must-diff-before-write]]` · `[[chairops-starthing-xlsx-schema-2026-05-27]]` · `[[chairops-sheet-42-tabs]]` (multi-floor pairs handling) |

### 2.6 · `app/(admin)/chairops/pos-ingest/page.tsx` + server actions — 2-click upload UX

| Item | Detail |
|---|---|
| Files | `app/(admin)/chairops/pos-ingest/page.tsx` + `actions.ts` (extend existing — line 531-643 already has diff-preview pattern per QC audit) |
| Flow | (1) Drag-drop XLSX → (2) Server parses + returns diff buckets `{ new, same, changed, unknown_branch }` → (3) Resolve "branch ใหม่ที่ไม่รู้จัก: 'xyz'" inline (no separate page) → (4) Click "บันทึก ยอด N รายการ" → redirect `/chairops` exec home with toast. |
| UX violations to fix | Current `pos-ingest/page.tsx:104-108` CTA says "อัปโหลด POS CSV" (drift) — change to "อัปโหลด POS XLSX (StarThing)". Current upload-form `:215-218` returns to list view, not exec home — change redirect target. |
| Acceptance | UX Flow A (§2): 4-step flow holds. Edge: duplicate file → "already imported on {date}" not error. Edge: 0 new rows → "ไฟล์นี้ไม่มีของใหม่" link. Edge: all rows error → block commit · show first 5 errors inline · friendly Thai. |
| Effort | 1 d (UI rewrite 0.5d + server-action wire 0.5d) |
| Memory cite | `[[chairops-upload-flow-simple-2026-05-27]]` (CEO 2-click target) · `[[pool-csv-import-must-diff-before-write]]` |

### 2.7 · `components/chairops/_kit/*` — DELETE forked Pool dupes (UI §3)

| DELETE | Reason |
|---|---|
| `components/chairops/ui/button.tsx` (40 LOC) | Identical to Pool `components/ui/button.tsx` |
| `components/chairops/ui/card.tsx` (37 LOC) | Identical |
| `components/chairops/ui/input.tsx` (19 LOC) | Pool input is richer |
| `components/chairops/ui/badge.tsx` (25 LOC) | Pool badge superset |
| `components/chairops/features/admin-shell.tsx` (REPLACE not delete) | Has translucent sticky bg violation + no module gate · replace with Pool-shared shell |

| KEEP | Reason |
|---|---|
| `components/chairops/_kit/kpi-tile.tsx` | Centered-value variant differs from Pool · extend with sparkline in W3 |
| `components/chairops/_kit/shortage-drift-cell.tsx` | ChairOps signature (cumulative-days badge) |
| `components/chairops/_kit/diff-bucket-pills.tsx` | Reused W0 + W2 |
| `components/chairops/_kit/photo-proof-panel.tsx` | Sticky right-rail pattern |
| `components/chairops/_kit/master-detail-shell.tsx` | Exports `stickyTheadClass()` used 4+ sites |
| `components/chairops/_kit/chair-code-chip.tsx` | Domain-specific |

| MERGE/REWRITE | Reason |
|---|---|
| `components/chairops/_kit/maker-checker-badge.tsx` | MERGE → `components/ui/badge-presets.ts` (just tone presets) |
| `components/chairops/_kit/line-notify-toggle.tsx` | REWRITE for W1 LINE OA (Notify is EOL) |

**Effort:** 2h (delete + update imports + grep-verify zero broken imports)

### 2.8 · `components/chairops/redesign/tokens.css` — NEW scoped token file

| Item | Detail |
|---|---|
| File | `components/chairops/redesign/tokens.css` (NEW · scoped `.co-scope`) |
| Tokens to add | Reuse Pool brand (`--co-brand: var(--color-brand-500)`) · ChairOps-only swatches: `--co-cell-ok #dcfce7`, `--co-cell-pending #fef3c7`, `--co-cell-late #fed7aa`, `--co-cell-missing #fee2e2` · radii/shadows/spacing scale · `--co-line-green #06c755` (LINE OA brand) · status palettes: `.co-status-{OPEN/ACK/RESOLVED/IGNORED}`, `.co-bill-{RECEIVED/APPROVED/PAID/DISPUTED/OVERDUE}`, `.co-period-{OPEN/SOFT_CLOSED/HARD_CLOSED}` (all WCAG AA verified per UI §4) |
| Apply via | `<body class="co-scope">` set in `app/(admin)/chairops/layout.tsx` AFTER entitlement gate. |
| Memory cite | `[[recruit-canvas-parity-2026-05-22]]` (4-6 distinct status tones pattern) · `[[sticky-bg-inherit-anti-pattern]]` (solid, no `/20 /30 /40`) |
| Effort | 1.5h |

### 2.9 · UI violations to fix (UI §5 · file:line list)

**Uppercase-Thai violations (`[[section-component-eyebrow-rootcause]]`) — mass-replace `text-[10-11px] font-bold uppercase tracking-wide` → `text-[11px] font-semibold tracking-[0.02em]`:**
- `app/(admin)/chairops/(office)/reconcile/page.tsx:360`
- `app/(admin)/chairops/(office)/reconcile/[branchId]/page.tsx:157, 653`
- `app/(admin)/chairops/(office)/write-offs/page.tsx:238, 280, 442, 463, 484, 492, 545`
- `app/(admin)/chairops/(office)/write-offs/write-off-selection-shell.tsx:186`
- `app/(admin)/chairops/users/new/new-user-form.tsx:73`
- `app/(admin)/chairops/users/[id]/page.tsx:186, 248, 309, 328, 353`
- `app/(admin)/chairops/users/[id]/user-detail-form.tsx:83`
- `app/(admin)/chairops/alerts/error.tsx:28`
- `app/(admin)/chairops/(office)/write-offs/error.tsx:30`

**Translucent sticky bg violations (`[[sticky-bg-inherit-anti-pattern]]`) — replace `bg-background/95 backdrop-blur` → solid `bg-background` (or `bg-white`):**
- `components/chairops/features/admin-shell.tsx:33`
- `app/(admin)/chairops/collect/_components/maid-shell.tsx:22`
- `app/(admin)/chairops/(office)/write-offs/page.tsx:335`
- `app/(admin)/chairops/(office)/write-offs/loading.tsx:6`
- `app/(admin)/chairops/alerts/loading.tsx:6`

**Effort:** 2h (mass-replace + visual smoke-test on each page)

### 2.10 · Cron observability — wrap handlers in `runWithMonitor()`

| Item | Detail |
|---|---|
| Files | `app/api/chairops/cron/recompute-drifts/route.ts` · `sop-check/route.ts` · `ceo-digest/route.ts` |
| Pattern | Wrap each handler with `runWithMonitor("chairops-<name>", async () => {...}, { req })` from `lib/cron/runner.ts` (already exists per DevOps §4) |
| Acceptance | After deploy, query `SELECT * FROM cron_runs WHERE cron_name LIKE 'chairops-%' ORDER BY started_at DESC LIMIT 10` returns rows · Telegram alert on fail |
| Effort | 1h |

### 2.11 · Owner-pre-commit blockers (Owner persona §Pre-commit must answer)

These must be locked **before W0 ships**:
1. **securityDeposit visibility** → admin-tier (org_admin/super_admin) only · NEVER expose to office staff. Spec: server action filters; default branch list omits the column.
2. **Alert routing — secondary recipient slot** → Owner wants this **in W0 schema** (not deferred to W3). Add `ChairopsBranch.secondaryAlertUserId` nullable FK + threaded into `lib/chairops/reconcile/alerts.ts` writer.
3. **LIFF rich-menu mockup** → must show CEO **before** building (Owner is brand-sensitive). Deferred to W1 deliverable but flagged here so CEO sees mockup at W0 exit gate.

### 2.12 · Wave 0 verify checklist (executable order · DevOps §8)

```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
pwd && cat .vercel/project.json | grep projectId       # must be pooilgroup
git status                                             # clean tree
npx prisma generate
npx tsc --noEmit                                       # the real gate
npx eslint .
npm run build                                          # next build
# smoke
curl -s https://pooilgroup.vercel.app/api/healthz | jq .
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://pooilgroup.vercel.app/api/chairops/cron/recompute-drifts?force=1 | jq .
# only THEN
vercel --prod
# DEVIL gate (NEW)
psql "$PROD_DIRECT_URL" -c "SELECT count(*), max(\"createdAt\") FROM \"ChairopsCashCollection\" WHERE \"createdAt\" > now() - interval '14 days';"
# if count < 50, STOP and re-evaluate before Wave 1
```

---

## 3 · Wave 1 / 2 / 3 abbreviated playbook

### Wave 1 · Maid + Office daily flow (revised 7-9 dev-day per PM)

**What we'll do:** Build `ChairopsLineChannel` + `ChairopsLineUserMap` tables · LINE OA webhook `/api/chairops/line/webhook` with HMAC verify (reuse Recruit pattern per `[[recruit-omnichannel-prod-2026-05-23]]` and `RECRUIT_CHANNEL_KEY` AES-256-GCM lib) · LIFF Mini App wrapping `/chairops/m/*` PWA routes · 4 maid flows (collect/cleanliness/damage/supply) with IndexedDB outbox v1 for offline · 30×4 office status grid at `/chairops/dashboard-office` with sticky thead solid bg · LINE Notify retirement behind `CHAIROPS_USE_LINE_NOTIFY=0` flag · 6-cell rich menu visual (brand-blue gradient header per UI §8). MANAGER_AREA stub (empty list helper) per Owner cut-list (defer real users).

**Key risks (mitigations):**
- LINE OA business verification 1-3d external wall-clock · CEO must start parallel to W0 (PM R-NEW-3).
- DEVIL adoption gamble: 60% maids may shadow back to LINE groups. Mitigate via 3-month overlap policy + dashboard-office one-tap "ส่งเตือน" template push + "ทุกข้อปกติ" 1-tap shortcut (Staff demand #10 + long-press 2s confirm).
- Real-device QA mandatory: 3 Android × 3 WiFi profiles per `[[recruit-canvas-parity-2026-05-22]]` lesson (Android Go 7.1, Samsung A03, iPhone SE2 × WiFi-good/h4-flaky/4G).
- Multi-floor branches (`[[chairops-sheet-42-tabs]]` 42 tabs vs 30 branches) — spec how 1:1 maid-branch rule handles multi-floor pairs (DEVIL hidden-complexity #5).

### Wave 2 · Vendor bills + accounting export (revised 6-8 dev-day)

**What we'll do:** `ChairopsVendorBill` + `ChairopsBillLineItem` + `ChairopsPeriod` (OPEN/SOFT_CLOSED/HARD_CLOSED) + `ChairopsAdjustmentRequest` + `ChairopsPeriodReopenLog` (immutable per `[[chairops-audit-2026-05-25]]`) + `ChairopsCOAMap` (CEO config) + `ChairopsGmailAuth` (refresh token AES-encrypted) tables. Gmail label `ChairOps/Bills` poll cron every 4h. **Manual-only AI parse button** per DEVIL revision: button on `/chairops/bills/[id]` says "AI parse this PDF" — fires single Claude Sonnet call · stores raw input+output forever for cost audit · status `RECEIVED` until CEO clicks APPROVE (never auto-approve per `[[ceo-prefers-manual-ai-triggers]]`). Period-close cron 1st-of-month soft-close. BC/Express CSV export with VAT mark · `companyId` (per audit D-NEW-7) · chart-of-account mapping.

**Key risks:**
- BA-flagged: Accountant didn't attend Phase 1 form — CEO must send mock CSV for sign-off before W2 starts (BA §8 critical).
- DEVIL: Thai mall PDF extract accuracy ~60-75% month 1, NOT 95% claim · expect manual fallback dominates.
- Race: Two officers approve same bill → optimistic-lock on `updatedAt` · friendly conflict toast (QA W2-9).
- Cost runaway: 30 bills/mo × Sonnet ~$3/$15 per M tokens · monthly env cap + token budget guard.

### Wave 3 · Polish + advanced (3-4 dev-day · CEO cut-candidate)

**What we'll do:** `/chairops/audit` 11-filter-chip page · audit-export self-audits (size-guarded, no infinite loop) · damage SLA cron escalates URGENT >24h via LINE OA push · spare-parts movement ledger · leaderboard top/worst 5 branches with sparkline · LINE OA push templates (EOD digest, weekly summary, CEO morning brief). Strict adherence to `[[sticky-thead-pattern]]` and `[[section-component-eyebrow-rootcause]]`.

**Key risks:**
- Owner explicitly listed W3 as #1 cut-candidate (Owner §What I'd cut).
- DEVIL: 85% predicts W3 never ships in full because CEO pivots to Playland mid-Wave-3 when devices arrive. **Plan W3 as optional shippable slices, not monolith.**
- DocuFlow/Recruit `next.config.ts` `ignoreBuildErrors:true` flag should be removed in W3 (DevOps §10) — non-ChairOps cleanup carved as tech-debt repayment.

---

## 4 · Consistency checklist ✓

| Check | Status | Plan |
|---|---|---|
| Uses host module's design tokens (not new ones) | PARTIAL — ChairOps will gain `.co-scope` scoped tokens (CashHub pattern) reusing Pool `--color-brand-*` | W0.8 ships `components/chairops/redesign/tokens.css` reusing brand-500 |
| Gates with module entitlement + role rank | ROOT layout correct (`chairops/layout.tsx:25-29`); nested layouts TBV; admin-tier allowlist bug | W0 fixes `module-access.ts:30` · W0 audits 11 nested layouts |
| All destructive ops have audit log | QC §audit findings: **all user-action mutations wrap with `writeAudit` ✓**. 3 cron/auto sites missing system-actor audits (alerts.ts:26,56 · drift-engine.ts:87 · sop-check route:43) | W1 add `userId: null` audits for cron lineage |
| Respects `[[module-entitlement-must-gate-all-layouts]]` | ✓ root · TBV nested | W0 nested-layout audit |
| Respects `[[role-rank-privilege-escalation-guard]]` | ✓ ChairOps uses ChairopsUserRole enum internally; Pool user-mgmt endpoints use `canAssignRole`/`canManageUser` | maintain |
| Respects `[[react-cache-on-getsession-pattern]]` | ✓ `lib/auth/session.ts:48` already wraps with `cache()`; ChairOps reuses | maintain |
| Respects `[[sticky-bg-inherit-anti-pattern]]` | ✗ 5 violations live (UI §5) | W0 fix list above |
| Respects `[[sticky-thead-pattern]]` | PARTIAL — `_kit/master-detail-shell.tsx:91-97 stickyTheadClass()` exists; ensure ALL list pages use it | W0 grep + apply |
| Respects `[[section-component-eyebrow-rootcause]]` | ✗ 20+ uppercase-Thai violations (UI §5) | W0 mass-replace |
| Respects `[[zod-v4-uuid-strict-rejects-seed]]` | ✓ `lib/chairops/schemas/zod-helpers.ts:6` uses `zUUID()` | maintain |
| Respects `[[pool-csv-import-must-diff-before-write]]` | ✓ POS-ingest already does diff (actions.ts:531-643) | W0 extend to XLSX |
| Respects `[[ceo-prefers-manual-ai-triggers]]` | ✓ design says manual button; DEVIL caught: cron-poll = background, not opt-in. Re-spec W2.2 to button-triggered single-call per PDF | W2 re-spec |
| Mobile-responsive | PARTIAL — maid `/m/*` exists; office dashboard not tested ≤640px | W1 real-device QA |
| CSV/XLSX imports diff-before-write | ✓ W0 deliverable | W0 |
| AI features opt-in only | TRUE if W2 re-spec'd per DEVIL (button-triggered, not cron-poll auto-extract) | W2 |
| React cache on per-request lookups | ✓ session helper · extend to other lookups as needed | maintain |
| Sticky theads use `top-14 sm:top-16 z-20` | TBV — use `stickyTheadClass()` helper | W0 audit |

---

## 5 · Risks (sorted by severity · top 10)

| ID | Risk | P × I | Mitigation |
|---|---|---|---|
| R1 | **Drift math wrong** — says "all good" while cash leaks (DEVIL Kill #6) | H × **CATASTROPHIC** | Dual-write 7-day legacy cf window · 13 BR1 test cases · CEO compares diff report before flip |
| R2 | **LINE Notify already dead today** (EOL 2025-03-31 < today 2026-05-27) — silent BR2 alerts | H × H | `curl notify-api.line.me/api/status` TODAY before W0 ship · if dead, accelerate W1 LINE OA into W0.5 |
| R3 | **LINE OA business verification rejected / >2 wk delay** (DEVIL 45%) | M-H × H | CEO starts day-1 parallel to W0 · ChairOps biz papers ready · backup plan = mute groups + single broadcast channel (DEVIL Lite path) |
| R4 | **`module-access.ts` admin allowlist fix breaks other modules** | L × H | Single-line change to use `Object.keys(MODULES)` · Vitest covering admin returns 8 slugs · Pool-wide CI |
| R5 | **Maids reject LIFF · shadow LINE groups** (DEVIL 60%) | M × M | 3-month overlap policy · 1-tap "ทุกข้อปกติ" + long-press 2s confirm (Staff §spec-check) · dashboard one-tap reminder · pilot 3-branch × 14-day not 1 × 5 (DEVIL minimum) |
| R6 | **Thai PDF extract accuracy ~60-75% month 1** (DEVIL hidden #4) — accountant 95% target missed | M-H × M | DEVIL re-spec: button-triggered single-call · manual entry form always available · re-evaluate after month 1 volume data |
| R7 | **Anthropic API cost runaway** (DEVIL 35%) | M × M | Token budget guard (per CLAUDE.md `lib/ai/budget-guard.ts` pattern) · monthly cap env · per-bill cost log |
| R8 | **StarThing XLSX schema drift mid-pilot** (DEVIL 30% · QA XLSX-9) | M × M | Parser surfaces column-set diff (not just row diff) · CEO sees unknown columns before commit · per `[[pool-csv-import-must-diff-before-write]]` |
| R9 | **DEVIL strategic-distraction: Playland devices arrive mid-ChairOps-W3** | M × M | Pre-W0 CEO confirms Playland device ETA · Wave 3 plan as optional shippable slices · checkpoint after W0 (DEVIL recommendation) |
| R10 | **Multi-floor branches break 1:1 maid-branch rule** (DEVIL hidden #5 · 42 tabs vs 30 branches) | M × L-M | W0 audit branch table for multi-floor pairs · W1 spec adapter (1 maid services parent + sub-floor) before coding LIFF |

---

## 6 · Effort estimate (synthesized · PM-revised)

| Wave | Plan claim | Synthesized | Δ | Notes |
|---|---|---|---|---|
| **W0** | 3-4 d | **4-5 d** | +1 | -1d (2 closed risks) +2d (orgId backfill + drift refactor + UI cleanup + secondary alert recipient + Owner pre-commits) |
| **W1** | 5-7 d | **7-9 d** | +2 | LINE OA external 1-3d wall-clock + 4 LIFF flows + IndexedDB outbox + 3-branch pilot 14-day (DEVIL min) |
| **W2** | 4-6 d | **6-8 d** | +2 | Period-close lifecycle + adjustment + BC/Express CSV + COA mapping + Gmail OAuth + manual-trigger AI |
| **W3** | 3-4 d | **3-4 d** | 0 | Polish; CEO #1 cut-candidate; DEVIL 85% never-fully-ships |
| **Buffer** | 0 | **2-3 d** | +3 | Real-device QA · training video for office staff (BranchMgr §Training) · CEO sponsor session |
| **Total** | 15-21 d | **22-29 d** | +7 | **~4.5-6 weeks** vs CEO's 3-4 week claim |

**Verdict:** CEO's 3-4 week claim is optimistic by ~1-2 weeks. Recommend communicating **5 weeks median with hard gates** at end of W0/W1/W2 where CEO can stop and validate.

---

## 7 · Acceptance criteria (synthesized · per role)

### CEO/Owner — "done" means
- Drag XLSX → see diff preview → commit → `/chairops` shows new rows + net-profit-per-branch-per-day tile
- Re-upload same XLSX = idempotent · 0 dupes
- Drift refactor: known shortage triggers alert within 24h; >30-day-old discrepancy does NOT re-fire
- securityDeposit visible to admin-tier only; never exposed to office staff
- 5 critical risks closed · `module-access.ts` admin sees ChairOps/ClawFleet/Playland in nav

### Office (BranchManager persona) — "done" means
- 30×4 status grid loads <5s · sticky thead solid bg · one-tap "ส่งเตือน" template push per maid
- "ใครยังไม่ส่งวันนี้" panel visible on `/chairops` exec home
- Audit page filters work (W3) · Excel export available (W3 cut-candidate but BranchMgr demand)
- Training: 30-min video for soft/hard close · Thai-only · CEO or Claude delivers (NOT developer)
- "หมายเหตุ" field present on collection rows (BranchMgr §อยากเพิ่ม)

### Maid (Staff persona) — "done" means
- LIFF Mini App opens in <3s from LINE rich menu · NO external browser open
- 4 flows (collect/clean/damage/supply) each ≤5 taps · Thai-only labels · 48dp tap targets
- Offline outbox: WiFi-dead submission → success page + nature-of-Sync indicator · auto-flushes on reconnect · ZERO data loss · idempotency dedupe on re-tap
- "ทุกข้อปกติ" 1-tap shortcut with long-press 2s confirm
- After damage submit: ticket code `RP-2569-XXXX` shown in large font · copy-able · LINE-shareable
- Re-submit same idempotency key returns "ส่งซ้ำแล้ว · บันทึกแล้วครั้งเดียว" (NOT error)

### Tech (Repair / Spare parts) — W3
- Damage queue with chair picker · urgency selector · spare parts ledger w/ in/out movements
- Supply request workflow (new/approved/shipped/received)

### Accountant (external · BA §8 flagged missing-from-Phase-1)
- April 2026 BC/Express CSV import ≥95% rows · ≤5% manual re-key
- VAT mark/rate per branch · companyId in every row
- **Pre-W2 sign-off:** CEO sends mock CSV to accountant for format approval

---

## 8 · Rollback plan (per wave · DevOps §7)

**Pre-step every wave:** `pwd && cat .vercel/project.json | grep projectId` (`[[verify-cwd-before-vercel-prod]]`)

| Wave | Rollback procedure | Time-to-revert |
|---|---|---|
| **W0** | (a) `CHAIROPS_DRIFT_MODE=legacy` env flip — drift engine returns to lifetime-sum without redeploy. (b) `ChairopsBranchDailyRevenue` is additive — `DROP TABLE` safe. (c) Cost field columns are nullable — keep · no rollback. (d) `module-access.ts` revert = single-PR revert. | 5-15 min |
| **W1** | `CHAIROPS_WAVE1_LINE_OA=off` env — hides rich menu + LIFF routes. LINE Notify fallback (if alive) re-activates. LIFF routes left dark · safe. | 5 min |
| **W2** | `CHAIROPS_WAVE2_BILLS=off` + `CHAIROPS_WAVE2_GMAIL_POLL=off`. Vendor bill UI + Gmail cron disabled · accounting CSV stays (read-only · no risk). Period-close: if soft-closed, manual SQL UPDATE to OPEN · CEO-supervised. | 5-30 min |
| **W3** | Pure additive · revert PR · no rollback procedure needed. | 5 min |
| **Catastrophic** | `MODULES_DISABLED=chairops` env — full module kill. Office team loses ChairOps for the duration; use only if data corruption suspected. | 5 min |

**Hard rules:** No `prisma db push --accept-data-loss` ever. Every wave ships with `supabase/migrations/rollback/W<N>.sql`. RLS/plpgsql RPCs require exact type match per `[[reserve-quota-int-bigint-bug]]`.

---

## 9 · Open questions for CEO (material impact on W0)

| # | Question | Why it matters | Default if no answer |
|---|---|---|---|
| **OQ-1** | securityDeposit visibility: admin-tier-only or all chairops users? | Affects W0 schema + UI access control. Owner persona explicitly demands admin-only. | **Admin-tier-only** (Owner §what's NOT in plan #2) |
| **OQ-2** | Secondary alert recipient: add `ChairopsBranch.secondaryAlertUserId` in W0 schema or defer to W3? | Owner wants it in W0 (Owner §pre-commit). Delaying = CEO can't go on vacation safely. | **W0 — single column, low effort, high CEO value** |
| **OQ-3** | DEVIL DESCOPE vote: re-affirm Full ship, or accept ChairOps Lite 6-day path? | DEVIL flagged Playland device window as competing priority. CEO Q4=Full ship was "how big" not "should we". | **Full ship with hard checkpoint after W0** (synthesizer pick — see §10) |
| **OQ-4** | LIFF rich-menu mockup approval before W1 build starts? | Owner is brand-sensitive (Pool ERP = premium SME look). Building then showing risks rework. | **Yes — Claude ships mockup at W0 exit gate** |
| **OQ-5** | DEVIL gate: run `SELECT count(*) FROM ChairopsCashCollection WHERE createdAt > now() - interval '14 days'` — if <50, interview 2 maids before W1? | "Is ChairOps used or deployed?" determines if we're building on a museum. | **Yes — gate W1 on this query result · 15-min check** |

---

## 10 · GO / WAIT / DESCOPE recommendation

### Synthesizer pick: **GO Wave 0 unconditional · CONDITIONAL Wave 1-3**

**Why GO Wave 0:**
- 5 P0 bugs closing on live prod (esp. `module-access.ts` admin allowlist — every admin user is invisibly blocked from 3 modules TODAY).
- XLSX upload + cost fields unlocks CEO's #1 ask (net profit per branch per day).
- Cost low (4-5 dev-day) · risk low (additive schema · single-line gate fix · feature-flagged drift refactor).
- DEVIL agrees on W0 ("Ship Wave 0 in full") and so do all 11 other personas.

**Why CONDITIONAL Wave 1-3:**
- DEVIL's vote (DESCOPE) is on the record with substantive concerns: Playland device window, LIFF adoption gamble (60% maids may shadow), Thai PDF accuracy (60-75% not 95%), and "paper architecture" risk if `ChairopsCashCollection` row count is near-zero.
- 9 of 11 other personas vote PASS/CONDITIONAL_PASS. Only PM is hard-PASS; QA, BA, UX, UI all hedge with "pilot data needed."
- Owner himself says "Wave 1 รอ checkpoint หลัง Wave 0" — Owner agrees with DEVIL's gate.

**Recommendation in order of priority:**
1. **Today:** Ship Wave 0 in full (4-5 dev-day). Get the bug fixes, XLSX upload, cost fields live.
2. **W0 exit gate (CEO 30-min review):**
   - Show last-14-day `ChairopsCashCollection` row count (DEVIL gate #2).
   - Show Playland device arrival ETA.
   - Show LIFF rich-menu mockup (Owner pre-commit #3).
   - Show drift-engine diff report (legacy vs window).
   - Verify `notify-api.line.me/api/status` (PM R-NEW-2 — is LINE Notify actually dead?).
   - **CEO re-decides Wave 1.** If data supports it (e.g., 50+ collections/14d AND LIFF mockup approved AND Playland devices >4 weeks out) → full Wave 1. If thin → DEVIL Lite path (broadcast channel only).
3. **W2 conditional on accountant sign-off** (BA §8) AND DEVIL re-spec'd to button-triggered AI parse (per `[[ceo-prefers-manual-ai-triggers]]` strict reading).
4. **W3 framed as optional shippable slices** (audit page · damage SLA · leaderboard · LINE OA templates), not monolith. CEO can stop after any slice.

**One-line CEO briefing:** "Wave 0 unblocks 6 P0 bugs live on prod and gives you net-profit-per-branch — ลุยทันที. After Wave 0, มี checkpoint 30 นาที — เราดูจำนวน collection 14 วันที่ผ่านมา · ดูว่า Playland ใกล้มา hardware แล้วยัง · ตัดสินใจ Wave 1 อีกที. DEVIL persona voted DESCOPE — เหตุผลคือคุณมีไฟ Playland จี้อยู่หลังคอ — เราเคารพ vote นั้นด้วย checkpoint ไม่ใช่ override เงียบ ๆ."

---

## 11 · Memory + decisions to save after CEO sign-off

| Memory slug | What to record |
|---|---|
| `chairops-w0-shipped-2026-05-27` | What W0 delivered · acceptance pass · row counts at gate · CEO decision on Wave 1 |
| `loadusermodules-admin-allowlist-bug-2026-05-27` | Pool-wide bug · single-line fix · cite this SPEC `§1 finding #1` |
| `chairops-drift-window-refactor-2026-05-27` | Daily-window replaces lifetime-sum · materialized view pattern · 7-day dual-write |
| `chairops-w0-orgid-backfill-2026-05-27` | All 16 models gained `orgId` · unique constraints scoped to org · backfill SQL preserved |
| `chairops-devil-vote-descope-overridden-2026-05-27` | Record DEVIL's concerns and CEO's final call with date · NOT silent override |

---

## 12 · Persona vote tally

| Persona | Vote | Conditions |
|---|---|---|
| PM | **GO Wave 0** · CONDITIONAL Wave 1-3 | LINE OA verify TODAY · pilot 3-branch × 14-day · 5-week timeline |
| BA | **CONDITIONAL_PASS** | 6 open business questions · accountant sign-off pre-W2 · stakeholder gap mitigations |
| SA | **GO Wave 0** · need orgId backfill · drift refactor | 8 new bugs added (B-SA-1..12) · multi-tenancy gate critical |
| UX | **GO** | Tile #6 net-profit must be on exec home in W0 · auto-redirect after commit · breadcrumbs in W3 |
| UI | **GO** | `.co-scope` tokens in W0 · 25+ violations cleaned · 121 LOC dead-fork DELETE |
| QA | **GO with money-math test coverage** | 13 BR1 cases for drift · idempotency · real-device QA non-negotiable W1 |
| QC | **PASS** | 0 type-safety violations today · maintain · add system-actor cron audits W1 |
| DevOps | **GO Wave 0 safe to deploy today** | Wrap crons in `runWithMonitor` · layered feature flags · rollback procedures per wave |
| Owner | **GO Wave 0 today** · CHECKPOINT before W1 | 3 pre-commits: securityDeposit admin-only · secondary alert in W0 · LIFF mockup pre-build |
| BranchManager | **PASS** | Training video required · Thai-only · CEO or Claude trains, NOT dev |
| Staff | **PASS — conditional on UX** | "ทุกข้อปกติ" + offline outbox + 48dp tap + Thai-only labels mandatory |
| DEVIL | **DESCOPE** | Ship Wave 0 in full · ChairOps Lite Wave 1 (broadcast channel, no LIFF) · HOLD W2 AI parser · HOLD W3 |

**Net:** 10 GO · 1 CONDITIONAL_PASS · 1 DESCOPE. Strong consensus on Wave 0. Material disagreement on Wave 1-3 scope · synthesizer resolves via post-W0 checkpoint (not silent override).

---

**END Phase 4 · ~3,400 words · SPEC ready for CEO review · Wave 0 actionable today**
