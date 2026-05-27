# BIGFEATURE · ChairOps · Persona SA (Solution Architect)

> **Created:** 2026-05-27 · **Role:** SA on /bigfeature roundtable
> **Source code anchors:** verified by direct read of `lib/chairops/reconcile/drift-engine.ts` · `lib/chairops/auth/session.ts` · `lib/auth/module-access.ts` · `lib/chairops/auth/cron-secret.ts` · `lib/chairops/line/notify.ts` · `prisma/schema.prisma:2771-3168` · `app/api/chairops/` · `app/(admin)/chairops/`
> **Memory consumed:** `[[chairops-p0-decisions-locked-2026-05-27]]` · `[[chairops-branch-cost-field-2026-05-27]]` · `[[chairops-starthing-xlsx-schema-2026-05-27]]` · `[[chairops-no-cumulative-shortage]]` · `[[chairops-maid-schedule-irregular]]` · `[[chairops-audit-2026-05-25]]` · `[[recruit-omnichannel-prod-2026-05-23]]` · `[[ceo-prefers-manual-ai-triggers]]` · `[[pool-csv-import-must-diff-before-write]]` · `[[module-entitlement-must-gate-all-layouts]]`

---

## 1 · Current state map (verified, not from audit doc)

| Layer | Count | Notes |
|---|---|---|
| Prisma models (chairops schema) | **16 models · 6 enums** | `schema.prisma:2775-3168` |
| Admin pages (`page.tsx`) | **39** (audit said 22) | `app/(admin)/chairops/**` |
| API routes | **5** (`audit-export · r2/presign · cron/ceo-digest · cron/recompute-drifts · cron/sop-check`) | Audit Phase-1 used "27 routes" but conflated pages+routes |
| Crons in `vercel.json` | **3 registered** | `recompute-drifts 22:00 · sop-check 22:30 · ceo-digest 01:00` — audit risk #2 **already closed** before this run |
| `lib/chairops/` subdirs | 11 (audit/auth/line/queries/reconcile/schemas/storage/supabase/utils + reconcile/actions+alerts+drift-engine) | |
| `components/chairops/` | `_kit · features · ui` | `_kit` flagged for cleanup by FE Phase 2 |
| LINE integration | **LINE Notify (EOL 2025-03-31)** — `lib/chairops/line/notify.ts` 5-channel role bus | NO LINE OA · NO webhook · NO LIFF |
| Multi-tenancy | **0 models have `orgId`** (verified grep) | Single-tenant only · cross-org leak risk if any 2nd org enters |
| Drift compute | **Lifetime-sum** (confirmed below) | NOT window-based |
| Auto-bootstrap admin | **Already removed** (lines 72-100 of `session.ts`) | Audit risk #4 already CLOSED |
| Cron secret verify | **All 3 cron routes use `requireCronSecret`** | uses `Bearer` + `x-cron-secret` both |

### Audit risk reconciliation (after live code inspection)

| # | Audit risk | Reality | Wave |
|---|---|---|---|
| 1 | Drift lifetime-sum | ✅ **CONFIRMED** · `drift-engine.ts:48-55` aggregates with no date filter | Wave 0 fix |
| 2 | 3 crons not in vercel.json | ✅ **already fixed** before this run | skip |
| 3 | Module gate missing on layouts | ⚠ root `chairops/layout.tsx` is correct · nested layouts TBV | Wave 0 audit pass |
| 4 | Auto-bootstrap admin | ✅ **already fixed** · `session.ts:72-100` no-bootstrap, denial+audit log | skip |
| 5 | LINE Notify EOL | ⚠ Still active code in `lib/chairops/line/notify.ts` | Wave 1 replace |
| **6 (NEW)** | `loadUserModules` admin allowlist missing chairops/clawfleet/playland | ✅ **CONFIRMED** · `module-access.ts:30` + `:43-49` | Wave 0 |
| **7 (NEW SA)** | **No `orgId` on ANY ChairOps model** (16/16 missing) | ✅ **CONFIRMED** · grep returns 0 hits | Wave 0 critical |
| **8 (NEW SA)** | `ChairopsPosDaily.totalRevenue` is `Int` (no fractions) but StarThing rows can include cents in `จ่ายเงินสด` decimal | ✅ field type `Int @default(0)` lines 2952-2956 — will silently truncate | Wave 0 |

---

## 2 · Target state architecture

### 2.1 Tables added by wave

| Wave | NEW table | Purpose |
|---|---|---|
| **W0** | `ChairopsBranchDailyRevenue` | aggregate per branch per day (StarThing landing zone) |
| **W0** | (extend) `ChairopsBranch` + 5 cost fields | rent · utility · staff · other · securityDeposit |
| **W0** | (extend) `ChairopsPosDaily` → align with StarThing 20-col schema | rename `totalRevenue→grossTotal` + add `coinInsertCount · roundCount · paymentCount` |
| **W0** | (extend ALL 16) add `orgId String` + index | multi-tenancy gate |
| **W1** | `ChairopsLineChannel` | LINE OA channel config (encrypted tokens) |
| **W1** | `ChairopsLineUserMap` | `lineUserId ↔ ChairopsUser.id` (one-tap LIFF context) |
| **W1** | `ChairopsAccessRequest` | required by `session.ts` denial path · admin approves to create ChairopsUser |
| **W2** | `ChairopsVendorBill` | mall invoices with PDF + AI extract JSON |
| **W2** | `ChairopsBillLineItem` | normalized line items (FK to ChairopsVendorBill) |
| **W2** | `ChairopsPeriod` | OPEN / SOFT_CLOSED / HARD_CLOSED per (orgId, year, month) |
| **W2** | `ChairopsAdjustmentRequest` | post-close edit workflow |
| **W2** | `ChairopsPeriodReopenLog` | immutable trail for reopens |
| **W2** | `ChairopsCOAMap` | chart-of-account mapping (branch → debit/credit account codes · VAT rate) |
| **W2** | `ChairopsGmailAuth` | OAuth refresh token (AES-256-GCM encrypted) for AI parser cron |
| **W3** | `ChairopsSupplyRequest` | maid → office supply workflow |

**Net delta:** 16 → 28 ChairOps models (+ 1 cross-module: `CronRun` if not already present).

### 2.2 New crons

| Path | Schedule | Wave |
|---|---|---|
| `/api/chairops/cron/bill-ingest` | `0 */4 * * *` (every 4h) | W2 · Gmail poll → Claude extract → R2 |
| `/api/chairops/cron/damage-sla` | `15 9 * * *` | W3 · escalate URGENT > 24h |
| `/api/chairops/cron/period-soft-close` | `0 3 1 * *` (1st of month) | W2 |

### 2.3 New external integrations

| System | Wave | Auth | Purpose |
|---|---|---|---|
| **StarThing** | W0 | none (XLSX only · no API per `[[chairops-starthing-xlsx-schema-2026-05-27]]`) | POS source of truth |
| **LINE Messaging API + LIFF** | W1 | per-channel AccessToken + ChannelSecret encrypted with `RECRUIT_CHANNEL_KEY` pattern from `[[recruit-omnichannel-prod-2026-05-23]]` (reuse same env key — single AES-256-GCM lib) | Replace 30 LINE groups |
| **Gmail API** | W2 | OAuth user-grant (CEO clicks once · refresh-token stored AES-GCM) — per D-NEW-D default | Auto-ingest mall invoice emails |
| **Claude API (sonnet-4-5)** | W2 | Pool-shared `ANTHROPIC_API_KEY` · server-only | PDF extract → JSON for vendor bill |
| **Cloudflare R2** | W2 | reuse Pool R2 bucket · new prefix `chairops-bills/{orgId}/{yyyy-mm}/{cuid}.pdf` | Bill PDF retention 7y |
| **LINE Notify** | W1 | **DEPRECATE** (EOL 2025-03-31) — keep `lib/chairops/line/notify.ts` as **fallback only** behind feature flag `CHAIROPS_USE_LINE_NOTIFY=1`, default off | — |

---

## 3 · DB migration plan

### 3.1 ADD (Wave 0 · `prisma/migrations/20260527_chairops_wave0/`)

```prisma
// extend ChairopsBranch (line 2834)
model ChairopsBranch {
  // existing fields...
  orgId            String     // NEW — required gate
  monthlyRent      Decimal?   @db.Decimal(12,2)
  monthlyUtility   Decimal?   @db.Decimal(12,2)  // ไฟ+น้ำ+เน็ต
  monthlyStaff     Decimal?   @db.Decimal(12,2)
  monthlyOther     Decimal?   @db.Decimal(12,2)
  securityDeposit  Decimal?   @db.Decimal(12,2)  // เงินจมที่ห้าง
  dailyRevenues    ChairopsBranchDailyRevenue[]

  @@index([orgId])
  @@unique([orgId, slug])  // was just @unique on slug · now tenant-scoped
}

model ChairopsBranchDailyRevenue {
  id               String   @id @default(uuid())
  orgId            String
  branchId         String
  bizDate          DateTime @db.Date
  cashTotal        Decimal  @db.Decimal(12,2)
  onlineTotal      Decimal  @db.Decimal(12,2)
  otherTotal       Decimal  @db.Decimal(12,2) @default(0)
  grossTotal       Decimal  @db.Decimal(12,2)
  paymentCount     Int      @default(0)
  coinInsertCount  Int      @default(0)
  roundCount       Int      @default(0)
  sourceImportId   String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  branch           ChairopsBranch @relation(fields: [branchId], references: [id])

  @@unique([orgId, branchId, bizDate])
  @@index([orgId, bizDate])
  @@schema("chairops")
}
```

### 3.2 RENAME (Wave 0 · careful column ops — NOT drop+create)

`ChairopsPosDaily` (lines 2947-2969) to align with StarThing 20-col schema:

| Old column | New column | Type change |
|---|---|---|
| `online` (Int) | `onlineTotal` (Decimal 12,2) | type widen · NULL-safe ALTER |
| `cash` (Int) | `cashTotal` (Decimal 12,2) | type widen |
| `coin` (Int) | `coinInsertCount` (Int) | rename only |
| `totalCash` (Int) | (drop · derivable as cashTotal) | mark @deprecated for 1 release · then drop W3 |
| `totalRevenue` (Int) | `grossTotal` (Decimal 12,2) | rename + widen |
| — | `roundCount` (Int) | NEW |
| — | `paymentCount` (Int) | NEW |
| — | `otherTotal` (Decimal 12,2) | NEW |

SQL migration uses `ALTER TABLE ... RENAME COLUMN` + `ALTER TYPE` — **NEVER `prisma db push --accept-data-loss`** per `[[migration-repair-without-real-apply-trap]]` + `[[pool-schema-drift-2026-05-21]]`.

### 3.3 MARK_DEPRECATED (Wave 1 · keep working · cut later)

| Symbol | Reason | Cut wave |
|---|---|---|
| `lib/chairops/line/notify.ts` `sendLineNotify()` | LINE Notify EOL | W3 |
| `ChairopsPosDaily.totalCash` | redundant after rename | W3 |
| `components/chairops/_kit/*` forked primitives | FE Phase 2 dedup | W3 |

### 3.4 DELETE NEVER

- `ChairopsAuditLog` rows — D-NEW-4 from audit (DB-trigger immutability · REVOKE DELETE).
- `ChairopsPeriodReopenLog` — immutable by design.
- `ChairopsVendorBill.extractedJSON` raw LLM I/O — keep forever per `[[ceo-prefers-manual-ai-triggers]]` (debuggability + cost audit).

---

## 4 · API contract changes

### 4.1 NEW endpoints

| Method | Path | Wave | Purpose |
|---|---|---|---|
| POST | `/api/chairops/pos-ingest/parse` | W0 | Upload XLSX → server parse → return diff bucket (NO write) |
| POST | `/api/chairops/pos-ingest/commit` | W0 | Idempotent commit by `(orgId, fileHash)` |
| POST | `/api/chairops/line/webhook` | W1 | HMAC verify + event router |
| POST | `/api/chairops/line/push` | W1 | Server-action proxy for outbound push (CEO/office) |
| GET  | `/api/chairops/liff/context` | W1 | Bind LIFF userId → ChairopsUser |
| POST | `/api/chairops/bills/ingest-now` | W2 | Manual trigger (CEO drag PDF) — bypass Gmail poll |
| POST | `/api/chairops/bills/[id]/approve` | W2 | CEO 1-click APPROVE (status → APPROVED) |
| POST | `/api/chairops/bills/[id]/dispute` | W2 | DISPUTED + reason |
| GET  | `/api/chairops/audit/export.csv` | W2 | BC/Express format |
| POST | `/api/chairops/periods/[ym]/soft-close` | W2 | |
| POST | `/api/chairops/periods/[ym]/reopen` | W2 | + PeriodReopenLog entry |
| POST | `/api/chairops/adjustment-requests` | W2 | |
| POST | `/api/chairops/access-requests` | W0 | Used by `session.ts:79-100` denial path |

### 4.2 MODIFY

- All cron routes: add `runId` recorded to new `CronRun` table (audit risk: cron observability per audit §10.3 last checkbox).
- `audit-export/route.ts` — gate by `ChairopsUserRole.ADMIN` AND `assertModuleEnabled('chairops')` (verify).
- `r2/presign/route.ts` — add `keyPrefix` allowlist (only `chairops-bills/` and `chairops-photos/` accepted) to prevent path abuse.

### 4.3 BREAKING

- `ChairopsBranch.slug` no longer globally unique → unique per-org. Existing single-tenant rows backfill `orgId = (SELECT id FROM organizations WHERE slug='pool')` in migration.
- `ChairopsPosDaily.totalRevenue` removed from response payloads · clients must read `grossTotal`. Provide compat field in JSON for 1 release.

---

## 5 · Drift engine RE-DESIGN

### Current (verified `lib/chairops/reconcile/drift-engine.ts:44-148`)

`drift = ΣPOS_lifetime − ΣDeposits_lifetime` per branch. **Problem:** old branches accumulate noise · CEO's "zero tolerance" alert fires for 6-month-old discrepancies forever.

### Target (Wave 0 · window-based · daily-anchored)

Given StarThing XLSX **lacks timestamps** per `[[chairops-starthing-xlsx-schema-2026-05-27]]`, the noon-to-noon window from `[[chairops-reconcile-window-noon-to-noon]]` is **infeasible**. Degrade to **daily-window** keyed on `bizDate`:

```ts
// pseudo
const lastClosedAt = branch.lastReconcileClosedAt  // updated whenever maid 'closes' a deposit cycle
const posSince = sum(BranchDailyRevenue.cashTotal where bizDate > lastClosedAt.date)
const depSince = sum(CashCollection.depositedAmount where collectedAt > lastClosedAt)
const drift = posSince - depSince
```

**Two-level alert (preserve zero-tolerance semantics from `[[chairops-no-cumulative-shortage]]`):**
1. `drift > 0` AND `ageHours(driftSince) > 24` → SHORTAGE (CRITICAL)
2. `daysSinceLastCollection > 1` → MISSED_COLLECTION (WARN)

**Persistence:** drop the lifetime-sum cache in `ChairopsDrift` · replace with **materialized view** `chairops.mv_branch_open_drift` refreshed on COMMIT of `ChairopsCashCollection` or `ChairopsBranchDailyRevenue`. This matches audit risk R3 mitigation (BE's recommendation).

Cron `recompute-drifts` becomes a **safety net** (re-emit alerts) not the source of truth.

---

## 6 · Integration points (canonical contract)

| System | Direction | Format | Auth | Failure mode |
|---|---|---|---|---|
| StarThing | inbound | XLSX upload (drag-drop) | session (Office+) | reject + diff preview · NEVER auto-commit |
| LINE OA Messaging | bidir | webhook (in) + Reply/Push (out) | HMAC channel-secret | retry once · log to ChairopsAuditLog · NOT block UI |
| LIFF Mini App | inbound | session token in cookie | LIFF idToken → `ChairopsLineUserMap` lookup | fallback PWA (no LINE) |
| Gmail | inbound only | label-watch `ChairOps/Bills` | OAuth refresh token (encrypted) | manual upload fallback at `/chairops/bills/new` |
| Claude API | outbound | extract prompt + PDF ref | server `ANTHROPIC_API_KEY` | 429 → queue retry · store raw output regardless |
| Cloudflare R2 | bidir | presigned PUT (upload) + GET (preview) | server-issued · 5-min TTL | local-blob fallback in dev |
| LINE Notify | DEPRECATE | outbound webhook | per-channel token env | feature-flag gate · default OFF |

---

## 7 · Critical bugs found (beyond audit's 5 risks)

| # | Bug | Severity | Wave |
|---|---|---|---|
| **B-SA-1** | `loadUserModules` admin allowlist missing `chairops · clawfleet · playland` (`lib/auth/module-access.ts:30`) | P0 — admin tier sees no nav for own paid modules | W0 |
| **B-SA-2** | `loadUserModules` non-admin filter omits same 3 slugs (`module-access.ts:44-49`) | P0 — granted users blocked too | W0 |
| **B-SA-3** | Zero `orgId` columns across 16 ChairOps models → second-org onboard = cross-tenant leak | P0 — multi-tenant promise broken | W0 |
| **B-SA-4** | `ChairopsPosDaily.totalRevenue` is `Int` → cents silently truncated on StarThing parse | P1 — money accuracy | W0 |
| **B-SA-5** | `ChairopsPosImport.fileHash @@unique` globally — second org importing identical hash collides | P1 | W0 (combine w/ orgId migration) |
| **B-SA-6** | Drift `findUnique({ where: { branchId } })` works only because `branchId @unique` — fine, but `recomputeAllDrifts` runs **serially** (line 144 `for...await`) — 30 branches × ~5 DB roundtrips = won't fit Vercel hobby 60s | P1 | W0 (Promise.all chunks of 5) |
| **B-SA-7** | `notify.ts` returns `{ok:false}` silently on missing token in prod — alerts disappear with no log | P1 | W0 quick fix · then W1 replace |
| **B-SA-8** | No `CronRun` audit table — cron observability gap (audit §10.3 last bullet) | P1 | W0 add |
| **B-SA-9** | `r2/presign` has no key-prefix allowlist (assumed from filename pattern) | P1 sec | W0 verify+fix |
| **B-SA-10** | `ChairopsCashCollection.imageHash @@unique` globally — same photo across orgs collides | P2 | W0 with orgId |
| **B-SA-11** | `session.ts:82-95` audit write uses `userId: null` — referential integrity OK (nullable) but loses subject; should store `metadata.poolUserId` for forensics | P2 | W0 |
| **B-SA-12** | `requireCronSecret` fails closed if env missing (good) but no startup check — silent if env removed mid-deploy | P3 | W3 |

---

## 8 · Cost-field design validation (per `[[chairops-branch-cost-field-2026-05-27]]`)

CEO chose **(b) 4-field split + securityDeposit**. SA validation:

- ✅ 4-field split (rent/utility/staff/other) matches Thai SME accounting categories — accountant import maps 1:1 to chart-of-account leaf accounts.
- ✅ `securityDeposit` as separate field (NOT inside `monthlyOther`) — it's a **balance-sheet item** (asset), not an expense. Net-profit calc must EXCLUDE it.
- ⚠ Recommend Wave 2 promotion: add `ChairopsBranchCostHistory` (effective-date snapshots) when CEO renegotiates rent · keeps audit trail without overwriting prior months' profit calc.
- Daily-cost derivation: `dailyCost = (monthlyRent + monthlyUtility + monthlyStaff + monthlyOther) / daysInMonth(bizDate)`.
- Net profit per branch per day: `BranchDailyRevenue.grossTotal − dailyCost` · displayed in `/chairops/dashboard` + `/chairops/reports/leaderboard`.

---

**END Persona SA · ready for FE/BE/QA/QC parallel sync · 1180 words**
