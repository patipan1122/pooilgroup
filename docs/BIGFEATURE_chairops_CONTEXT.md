# BIGFEATURE · ChairOps · Phase 0 Context Sync

> **Created:** 2026-05-27 · Run #1 of /bigfeature on ChairOps
> **Mode:** Full ship (CEO /goal "ทำทั้งหมดให้สมบูรณ์")
> **Source:** STATUS.md + memory + actual filesystem inventory

---

## 1 · Module landscape (Pool ERP — 8 modules)

| Module | Status | Path | Crons | Notes |
|---|---|---|---|---|
| **CashHub** | active | `/cashhub` | shortage-digest | Brand blue · single SoT for daily cash |
| FuelOS | coming_soon | `/fuelos` | — | Quarantined (16 models in quarantine block) |
| DocuFlow | active | `/docuflow` | docuflow-expiry | 1,100+ docs |
| Recruit | active | `/recruit` | — | LINE/FB omnichannel done |
| **Repairs** | active | `/repairs` | — | Slug `repairs` · live |
| ClawFleet | active | `/clawfleet` | photo-retention · session-autoclose | 4-workspace nav (Hub/Operations/Insights/Setup) |
| **ChairOps** | active | `/chairops` | recompute-drifts · sop-check · ceo-digest | **TARGET of this run** |
| Playland | active | `/playland` | expire-sessions · expire-bookings | ACS-F606 face gate |

**Module entitlement engine:** `lib/auth/module-access.ts`
- `assertModuleEnabled(slug)` = kill switch + session + per-user grant check
- Admin tier (super_admin/org_admin/admin) bypasses entitlement
- 🐛 **BUG FOUND:** `loadUserModules()` admin-tier branch returns only `["cashhub", "fuelos", "docuflow", "recruit", "repairs"]` — missing `chairops`, `clawfleet`, `playland`. **Wave 0 fix required.**

**Module kill switch:** `MODULES_DISABLED=chairops` env hides + blocks.

---

## 2 · Role hierarchy (`lib/auth/role-guards.ts`)

```
super_admin    rank 100  (Pool top · cross-org)
org_admin      rank 80   (CEO of this Pool tenant)
admin          rank 60   (system admin)
area_manager   rank 40   (regional mgr — NONE in ChairOps per `[[chairops-p0-decisions-locked-2026-05-27]]`)
branch_manager rank 30   (head of branch)
staff          rank 20   (maid / front-line)
driver         rank 15
viewer         rank 10
```

**Privilege escalation guard:** `canAssignRole` + `canManageUser` — caller MUST out-rank target. Per `[[role-rank-privilege-escalation-guard]]`.

**ChairOps additional roles** (in `chairops` schema · NOT Pool DbUser): `ChairopsUserRole` enum (admin/manager/office/maid/tech) inside ChairopsUser table.

---

## 3 · ChairOps current state (actual file inventory)

### 3.1 Prisma schema · 16 models (lines 2771-3173)

```
ChairopsUserRole (enum)
ChairopsAlertLevel · ChairopsAlertStatus · ChairopsAlertKind (enums)
ChairopsTicketStatus · ChairopsCleanlinessGrade (enums)

ChairopsBranch          (line 2834) — 30 branches · matches StarThing 30+ tabs
ChairopsUser            (line 2862) — separate from Pool DbUser
ChairopsMaidAssignment  (line 2893) — 1:1 maid-branch per [[chairops-maid-one-per-branch-collect-only]]
ChairopsChair           (line 2909)
ChairopsPosImport       (line 2930)
ChairopsPosDaily        (line 2947) — needs StarThing schema update per [[chairops-starthing-xlsx-schema-2026-05-27]]
ChairopsCashCollection  (line 2972)
ChairopsDrift           (line 2998) — drift-engine logic TBV
ChairopsAlert           (line 3015)
ChairopsWriteOff        (line 3038)
ChairopsDamageTicket    (line 3057)
ChairopsSparePart       (line 3084)
ChairopsSparePartMovement (line 3102)
ChairopsCleanlinessReport (line 3118)
ChairopsAuditLog        (line 3138)
ChairopsBankAccount     (line 3157)
```

### 3.2 Admin routes · `app/(admin)/chairops/`

**Root layout** (line 32) — ✅ correctly gates `assertModuleEnabled('chairops')`-equivalent flow

**(office) route group** — page.tsx + 6 subdirs:
- `pos-ingest` · `reconcile` · `write-offs` · `alerts` · `users`
- error.tsx · loading.tsx · layout.tsx (route-group scoped)

**(maid) route group** — `m/*` + `_components`

**Other admin pages:**
- `accounts` · `audit` · `cleanliness` · `collect` · `damage` · `dashboard` · `parts` · `reports`

### 3.3 API · `app/api/chairops/`

- `audit-export/`
- `cron/ceo-digest/` · `cron/recompute-drifts/` · `cron/sop-check/` ✅ all 3 cron endpoints exist
- `r2/` (presign for photo upload)

### 3.4 Library · `lib/chairops/`

- `audit/` (log writer)
- `auth/` — `actions.ts · cron-secret.ts · role-guards.ts · session.ts`
- `line/` (current LINE Notify)
- `queries/`
- `reconcile/` — `actions.ts · alerts.ts · drift-engine.ts`
- `schemas/` (Zod)
- `storage/` (R2)
- `supabase/`
- `utils/`

### 3.5 Components · `components/chairops/`

- `_kit/` (forked primitives flagged DELETE by FE Phase 2 of `[[chairops-audit-2026-05-25]]`)
- `features/`
- `ui/`

### 3.6 vercel.json crons

```json
{ "path": "/api/chairops/cron/recompute-drifts", "schedule": "0 22 * * *" },
{ "path": "/api/chairops/cron/sop-check", "schedule": "30 22 * * *" },
{ "path": "/api/chairops/cron/ceo-digest", "schedule": "0 1 * * *" }
```

✅ All 3 ChairOps crons registered — **audit risk #2 already CLOSED** (audit doc must have been written before commit `5e3a6d2`)

---

## 4 · Audit risk status (revised after Phase 0 inspection)

| # | Audit risk | Actual code state | Wave 0 action |
|---|---|---|---|
| 1 | Drift lifetime-sum | ❓ Verify `lib/chairops/reconcile/drift-engine.ts` | TBV in Phase 3 |
| 2 | 3 crons not registered | ✅ **Closed** — vercel.json lines 19-21 | Skip |
| 3 | Module entitlement missing | ✅ **Closed** — `app/(admin)/chairops/layout.tsx` correct | Verify nested layouts in Phase 3 |
| 4 | Auto-bootstrap admin in getSession | ❓ Verify `lib/chairops/auth/session.ts` | TBV in Phase 3 |
| 5 | LINE Notify EOL | ❓ Verify `lib/chairops/line/` | Wave 1 — replace with LINE OA |
| **6 (NEW)** | `loadUserModules` admin-tier array missing chairops/clawfleet/playland | ❌ **Open** — `lib/auth/module-access.ts` line 30 | **Wave 0 Pool-wide fix** |

---

## 5 · Pool design tokens + patterns (consistency rules)

### Tokens (per scoped CSS files)

| Module | Scope class | Token base |
|---|---|---|
| CashHub | `.ch-scope` | brand blue |
| Recruit | `.recruit-canvas` | brand/amber/orange/purple/green/red (6 distinct per `[[recruit-canvas-parity-2026-05-22]]`) |
| ClawFleet | (TBD per `[[claude-design-clawfleet-2026-05-25]]`) | 4-workspace nav |
| Playland | (TBD) | — |
| **ChairOps** | **TBD** — design audit Phase 1 token plan should exist | Brand blue (consistent with Pool) |

### Patterns to follow

- **Sticky thead:** `top-14 sm:top-16 z-20` SOLID bg · per `[[sticky-thead-pattern]]` and `[[sticky-bg-inherit-anti-pattern]]`
- **Section eyebrow:** NO uppercase on Thai · `tracking ≤ 0.05em` · per `[[section-component-eyebrow-rootcause]]`
- **React cache:** wrap `getSession` with `cache()` per `[[react-cache-on-getsession-pattern]]`
- **Module gate:** `assertModuleEnabled` in every layout per `[[module-entitlement-must-gate-all-layouts]]`
- **Role rank:** use `canAssignRole`/`canManageUser` for user mgmt endpoints per `[[role-rank-privilege-escalation-guard]]`
- **Zod UUID:** `zUUID()` NOT `z.string().uuid()` per `[[zod-v4-uuid-strict-rejects-seed]]`
- **CSV/XLSX import:** diff-before-write per `[[pool-csv-import-must-diff-before-write]]`
- **AI features:** opt-in trigger only · NO auto-commit per `[[ceo-prefers-manual-ai-triggers]]`
- **Deploy:** verify cwd before `vercel --prod` per `[[verify-cwd-before-vercel-prod]]`

### Anti-patterns (must NOT do)

- `eval()` · `dangerouslySetInnerHTML` · dynamic import from user input
- `prisma db push --accept-data-loss`
- Bypass RLS via service role on client
- Push expecting auto-deploy prod (per `[[feedback-push-not-equals-deploy]]`)

---

## 6 · Existing memory rules ChairOps must respect

- `[[chairops-no-cumulative-shortage]]` — เงินห้ามขาดสะสม · alert immediate · OPPOSITE of CashHub
- `[[chairops-maid-one-per-branch-collect-only]]` — maid does NOT read meters · office reconciles
- `[[chairops-maid-schedule-irregular]]` — no fixed window · use cumulative-drift tracker
- `[[chairops-reconcile-window-noon-to-noon]]` — **infeasible w/o timestamp** per Phase 0 XLSX finding · DEGRADE to daily-window
- `[[chairops-zero-cumulative-shortage]]` — match above
- `[[chairops-sheet-42-tabs]]` — 42 source sheets · ~30 branch + utility tabs

---

## 7 · Goal scope (from CEO P0 locks)

Per `[[chairops-p0-decisions-locked-2026-05-27]]`:
- Q1 = StarThing XLSX (no API)
- Q2 = ~100 chairs (pilot scope)
- Q3 = No MGR_AREA users (default empty)
- Q4 = **Full ship** — 22 routes · 24 BRs · 10-14 new tables · 2-3 sprint
- Q5 = LINE OA + LIFF Mini App (replaces 30 LINE groups)
- Q6 = Wave 1 FIN (period-close + accounting export)

Plus 3 new features added 2026-05-27:
- Branch cost fields (rent/utility/staff/other) + securityDeposit
- ChairopsVendorBill + Gmail AI parser
- Simplified upload flow (drag XLSX → diff → commit → dashboard)

Wave breakdown in `docs/CHAIROPS_WAVE_PLAN_2026-05-27.md` (4 waves · 15-21 dev-day estimate).

---

## 8 · Out-of-scope (session lock per `[[chairops-only-session-scope-2026-05-27]]`)

- Other Pool modules: CashHub · DocuFlow · Recruit · Repairs · ClawFleet · Playland · FuelOS
- Buildly Go (separate repo)
- Pool legacy archive in `legacy/` (other dirs)

**Exception:** Wave 0 will touch `lib/auth/module-access.ts` to fix bug #6 — this is the SHARED Pool gate · necessary fix · single-line change.

---

**END Phase 0 · ready for Phase 1 stakeholder form + Phase 2 goal lock**
