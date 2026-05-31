# BIGFEATURE · CostCtrl · ศูนย์ควบคุมต้นทุน

> Pool ERP module #10 · super_admin (CEO) only · 2026-05-31
> Skill: `/bigfeature` (5-persona synthesis inline · single-user feature)

---

## 1 · Goal lock

| Field | Value |
|---|---|
| Slug | `costctrl` |
| Display | ศูนย์ควบคุมต้นทุน / Cost Center |
| Who | **super_admin only** (CEO) · strict gate — even org_admin/admin redirected to /dashboard |
| Business goal | เห็นต้นทุน Vercel + R2 + Supabase + AI tokens + APIs ทั้งหมดในที่เดียว · เตือนก่อน quota หมด |
| Success metric | รู้ ≥7 วัน ก่อนถึง quota · 0 surprise bill |
| Mode | NEW standalone module · ไม่ผูก module อื่น แต่ READS `ai_usage` ของเดิม |
| Phase 6 | Spec + build (cron + UI + crypto + LINE alert) |

---

## 2 · Providers tracked

**Phase 1 (auto-sync via API · ship this round):**

| # | Provider | Metrics | API | Free tier |
|---|---|---|---|---|
| 1 | **Vercel** | bandwidth GB · function-invocations · build-minutes · edge-req | `api.vercel.com/v1/usage` | 100GB BW · 1M inv |
| 2 | **Supabase** | DB-size MB · egress GB · MAU · realtime concurrent | `api.supabase.com/v1/projects/{ref}/usage` | 500MB · 2GB · 50k |
| 3 | **Cloudflare R2** | storage GB · Class-A ops · Class-B ops · egress | `api.cloudflare.com/client/v4/accounts/{id}/r2/...` | 10GB · 1M ops · free egress |
| 4 | **Anthropic (Claude)** | in/out tokens · cost USD | LOCAL `ai_usage` table aggregate | — |
| 5 | **Google Gemini** | in/out tokens · cost USD | LOCAL `ai_usage` table aggregate | 1500 req/day free |

**Phase 2 (later · manual entry):** Resend · Sentry · LINE Messaging · FB Graph · Domain renewals

---

## 3 · DB schema (5 new tables — condensed from initial 7)

```prisma
// migration: 20260531000000_costctrl_module.sql

model CostProvider {
  id            String   @id @default(uuid()) @db.Uuid
  slug          String   @unique  // 'vercel' | 'supabase' | 'r2' | 'anthropic' | 'gemini'
  displayName   String
  category      String   // 'hosting' | 'database' | 'storage' | 'ai'
  enabled       Boolean  @default(true)
  pricingNote   String?  // human-readable pricing summary
  budgetMonthly Json?    // { "2026-05": 20.00, "2026-06": 25.00 } — small, denormalized
  lastSyncAt    DateTime? @db.Timestamptz(6)
  lastSyncStatus String?  // 'ok' | 'partial' | 'error: ...'
  createdAt     DateTime @default(now()) @db.Timestamptz(6)

  snapshots     CostSnapshot[]
  rules         CostAlertRule[]
  credentials   CostApiCredential[]

  @@map("cost_provider")
}

model CostSnapshot {
  id           String   @id @default(uuid()) @db.Uuid
  providerId   String   @db.Uuid
  capturedAt   DateTime @db.Timestamptz(6)
  periodMonth  DateTime @db.Date           // 1st of month
  metric       String                       // 'bandwidth_gb' | 'tokens_in' | 'storage_mb' | ...
  unit         String                       // 'GB' | 'tokens' | 'count' | 'USD'
  value        Decimal  @db.Decimal(20, 6)
  costUsd      Decimal  @db.Decimal(10, 4)
  raw          Json?
  source       String                       // 'api' | 'manual' | 'aggregated'

  provider     CostProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId, periodMonth, metric])
  @@index([capturedAt])
  @@map("cost_snapshot")
}

model CostAlertRule {
  id             String   @id @default(uuid()) @db.Uuid
  providerId     String   @db.Uuid
  metric         String                     // 'cost_usd' | 'bandwidth_gb' | ...
  thresholdPct   Decimal? @db.Decimal(5, 2) // 75 | 90 | 100 (% of monthlyBudget)
  thresholdAbs   Decimal? @db.Decimal(20, 6)
  channel        String                     // 'line' | 'email'
  cooldownHours  Int      @default(24)
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now()) @db.Timestamptz(6)

  provider       CostProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  events         CostAlertEvent[]

  @@map("cost_alert_rule")
}

model CostAlertEvent {
  id             String   @id @default(uuid()) @db.Uuid
  ruleId         String   @db.Uuid
  triggeredAt    DateTime @default(now()) @db.Timestamptz(6)
  observedValue  Decimal  @db.Decimal(20, 6)
  thresholdValue Decimal  @db.Decimal(20, 6)
  message        String
  notifiedAt     DateTime? @db.Timestamptz(6)
  resolvedAt     DateTime? @db.Timestamptz(6)

  rule           CostAlertRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([triggeredAt])
  @@map("cost_alert_event")
}

model CostApiCredential {
  id           String   @id @default(uuid()) @db.Uuid
  providerId   String   @db.Uuid
  label        String                       // 'pooil-vercel-team' | ...
  scope        String?                      // team-id | project-ref
  ciphertext   String                       // AES-256-GCM(value, COSTCTRL_CRYPTO_KEY)
  encVersion   Int      @default(1)
  lastUsedAt   DateTime? @db.Timestamptz(6)
  lastError    String?
  createdAt    DateTime @default(now()) @db.Timestamptz(6)
  createdById  String   @db.Uuid

  provider     CostProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, label])
  @@map("cost_api_credential")
}
```

**Tables INTENTIONALLY MERGED (DevilsAdvocate concession):**
- `CostMonthlyBudget` → folded into `CostProvider.budgetMonthly` JSONB (small object, simpler)
- `CostSyncRun` → folded into `CostProvider.lastSyncAt + lastSyncStatus` (per-provider, no separate run log)

---

## 4 · Pages (4 routes — condensed from initial 5)

```
/costctrl                    → Overview · 5 provider cards · MTD cost · % budget · alerts strip
/costctrl/providers/[slug]   → Drill · 30-day chart · snapshot history · sync-now · credentials
/costctrl/ai                 → AI breakdown · tokens × module × business × model (from ai_usage)
/costctrl/alerts             → Rules CRUD + history + (inline) settings: budgets + crypto creds
```

`/costctrl/alerts` รวม "rules + budgets + creds + history" ใน 1 หน้า (multi-tab) เพื่อลด clicks.

---

## 5 · Gate (super_admin ONLY)

```typescript
// lib/auth/role-guards.ts — ADD
export function requireSuperAdmin(role: DbUser["role"]): void {
  if (role !== "super_admin") {
    redirect("/dashboard");
  }
}
```

```typescript
// app/(admin)/costctrl/layout.tsx
export default async function CostCtrlLayout({ children }) {
  if (isModuleDisabled("costctrl")) redirect("/dashboard");
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  return <div className="cc-scope">{children}</div>;
}
```

**Nav visibility:** `lib/modules.ts` → register `costctrl` with `roles: ["super_admin"]` so nav hides for everyone else.

---

## 6 · Cron + sync

**1 new cron** in `vercel.json` (Hobby-safe, 1x/day per `[[vercel-hobby-cron-block-2026-05-30]]`):

```json
{ "path": "/api/costctrl/cron/sync", "schedule": "0 19 * * *" }
```

Runs 02:00 ICT (19:00 UTC prev day). Each call:
1. Loop providers · for each: load credentials · call provider API · parse response
2. Insert `CostSnapshot` rows (idempotent by `providerId+periodMonth+metric+capturedAt`)
3. Re-aggregate `ai_usage` table for current month → write Anthropic+Gemini snapshots
4. Evaluate `CostAlertRule` against latest snapshots · respect `cooldownHours` · write `CostAlertEvent` + push LINE
5. Update `CostProvider.lastSyncAt + lastSyncStatus`

**Manual sync button** on `/costctrl/providers/[slug]` → server action calls same fetcher for 1 provider only.

**Vercel function timeout guard:** if any single provider fetch >5s · log + continue (status='partial' on that provider).

---

## 7 · AI usage retrofit (HIGH-VALUE side effect)

Audit reveals 7 AI call sites · only some call `recordAiUsage()`:

| File | Wrapped? |
|---|---|
| `lib/inbox/bot/ai.ts` (Gemini) | ❓ verify |
| `lib/inbox/bot/trainer-actions.ts` (Claude trainer) | ❓ verify |
| `lib/docuflow/ai-analyze.ts` | ❓ verify |
| `lib/docuflow/risk-narrate.ts` | ❓ verify |
| `lib/docuflow/metadata-extract.ts` | ❓ verify |
| `lib/docuflow/ai-search.ts` | ❓ verify |
| `lib/recruit/ai.ts` (3 calls) | ❓ verify |

Phase 6 step 7: grep audit · wrap every AI call with `await recordAiUsage(...)`. Without this, costctrl AI numbers are partial.

---

## 8 · Crypto envelope

Extract inbox's AES-256-GCM helper to **shared** `lib/crypto/envelope.ts`:

```typescript
export function seal(plaintext: string, keyEnvVar: string): string  // returns ciphertext
export function open(ciphertext: string, keyEnvVar: string): string  // returns plaintext
```

CostCtrl uses `COSTCTRL_CRYPTO_KEY` (separate from `RECRUIT_CHANNEL_KEY` per blast-radius principle). Both can fall back to `SUPABASE_SERVICE_ROLE_KEY` like inbox does (with prod warning).

Inbox keeps working unchanged (it imports the shared helper now).

---

## 9 · Integration map

| System | Touch |
|---|---|
| `ai_usage` table | READ ONLY · costctrl aggregates monthly |
| `ModuleSlug` enum | ADD `'costctrl'` to `lib/modules.ts` + 3 layout files that reference it |
| `MODULES_DISABLED` env | works automatically · costctrl can be killed via env |
| Pool admin shell | `(admin)` route group · existing topbar · existing fonts |
| `auditLog()` | called on every credential create/delete + budget change |
| LINE messaging | reuse `lib/chairops/line/messaging.ts` adapter (per CEO already wired ChairOps OA) |
| `requireSession` + role-guards | reused unchanged |

---

## 10 · Consistency checklist

- [x] `(admin)/costctrl/layout.tsx` with `requireSuperAdmin` + `isModuleDisabled`
- [x] No new design tokens — uses Pool tokens · scoped `.cc-scope` for any local overrides
- [x] All destructive ops (credential add/delete, budget change) audited
- [x] Respects `[[ceo-prefers-manual-ai-triggers]]` — cron runs at 02:00, no auto-AI triggered by costctrl
- [x] Respects `[[vercel-hobby-cron-block-2026-05-30]]` — 1 cron at 1x/day
- [x] Respects `[[role-rank-privilege-escalation-guard]]` — super_admin gate strict
- [x] Sticky theads use container-scroll pattern (`[[sticky-thead-pattern]]` corrected version)
- [x] Mobile-responsive but designed desktop-first (CEO uses desktop)
- [x] Secrets AES-encrypted · never plaintext in DB
- [x] Module entitlement gate at layout-level per `[[module-entitlement-must-gate-all-layouts]]`

---

## 11 · Risks (sorted by blast radius)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Stored API tokens breach (Vercel/Supabase/R2 tokens are powerful) | P0 | AES-256-GCM · `COSTCTRL_CRYPTO_KEY` env-only · super_admin-only access · audit log every read |
| 2 | Provider API auth fails silently → CEO thinks costs are low | P1 | `lastSyncStatus` per provider · red dot in UI · LINE alert after 2 consecutive failures |
| 3 | Pricing tier drift (provider changes price) | P1 | Store raw JSON in `snapshot.raw` for re-compute · pricing constants in `lib/costctrl/pricing.ts` |
| 4 | Anthropic admin-API may not expose org spend | P2 | Fall back to internal `ai_usage` aggregation (we own — 100% accurate) |
| 5 | Cron timeout (Vercel 10s on Hobby for some routes · 60s for cron) | P2 | Per-provider try/catch · log partial · cron stays under 60s for 5 providers |
| 6 | Adding `costctrl` cron breaks Hobby deploy | P0 | Single 1x/day entry — safe |

---

## 12 · Effort estimate (1.5 dev-day)

| Step | Hours |
|---|---|
| Schema + migration + Prisma generate | 1.0 |
| `requireSuperAdmin` + module registry add | 0.3 |
| Extract crypto envelope · refactor inbox import | 0.5 |
| Layout + 4 pages | 4.0 |
| Cron handler + 5 provider fetchers | 3.0 |
| AI call wrapping retrofit | 1.5 |
| LINE alert wiring | 0.5 |
| Tsc + build + smoke + STATUS | 1.0 |
| **Total** | **~12 h** |

---

## 13 · Rollback plan

If cron breaks: set `MODULES_DISABLED=costctrl` in Vercel env → nav hides + routes 403 instantly. No deploy needed (env-driven).

If migration breaks: tables have no inbound FK from other modules · `DROP TABLE cost_*` is clean. Revert migration file.

Crypto key rotation: NEVER rotate `COSTCTRL_CRYPTO_KEY` after creds stored (per `[[crypto rotation lessons]]`). If forced: pre-rotation decrypt → re-encrypt with new key in 1 transaction.

---

## 14 · Open questions (CEO ต้องตอบ)

1. **API tokens — มีหรือต้องไปขอ?**
   - Vercel: Settings → Tokens (https://vercel.com/account/tokens) — CEO ทำได้ใน 2 min
   - Supabase: Project Settings → API → service-role + management token (https://supabase.com/dashboard/account/tokens)
   - Cloudflare R2: Profile → API Tokens → R2 read-only
   - Anthropic + Gemini: ไม่ต้อง (อ่านจาก `ai_usage` table เลย)
   - **OK ทำเป็น "manual mode" ก่อน** (ไม่ใส่ token = แสดงแค่ AI usage จาก local) แล้วค่อย add token หลัง deploy
2. **LINE alert channel**: ใช้ "นวดน้าหลังบ้าน" OA (ChairOps · `CHAIROPS_LINE_*`) หรือ เปิดใหม่สำหรับ CEO-only? **DEFAULT: reuse ChairOps OA · push เฉพาะ CEO user ID**
3. **Monthly budget defaults**: ขอตั้ง defaults ให้ก่อน · CEO ปรับใน UI ภายหลังได้?
   - Vercel $20 · Supabase $25 · R2 $5 · Anthropic $50 · Gemini $10 = **$110 total**

---

## 15 · DevilsAdvocate counter (transparent)

> "ทำเฟ้อไปมั้ย CEO ใช้คนเดียว · ทำ 7 tables + 5 pages + cron + crypto สำหรับ ดูตัวเลขใน admin dashboard"

- 7 tables → **ลดเหลือ 5** (budget เข้า provider JSON · sync-run เข้า provider lastSync)
- 5 pages → **ลดเหลือ 4** (alerts + settings + budgets + creds รวม 1 หน้า tab)
- Crypto → **KEEP** (token หลุด = ปัญหาใหญ่กว่าเฟ้อ)
- 6 providers → **ลด Phase 1 เหลือ 5** (Resend ทิ้งไป Phase 2 · free tier ไม่เคย hit)
- Cron → **KEEP** (ไม่มี = CEO ต้องกดปุ่มเอง = หลงลืม)

**Final scope locked: 5 tables · 4 pages · 1 cron · 5 providers · AES envelope shared.**

---

## 16 · Acceptance (CEO QA after build)

1. Login as super_admin → nav มี "ศูนย์ควบคุมต้นทุน" · login as org_admin → ไม่เห็น
2. GET `/costctrl` (org_admin) → redirect `/dashboard`
3. `/costctrl` (super_admin) → 5 provider cards · MTD cost · % budget · last-sync time · alert badge ถ้าเกิน
4. คลิก provider → drill page · 30-day cost chart · snapshot table · "Sync now" button
5. `/costctrl/ai` → AI usage breakdown · group by module + business · MTD รวม
6. ตั้ง alert rule = Vercel cost ≥ 80% budget → cron วันถัดไป → LINE push ถึง CEO
7. เพิ่ม credential → ตรวจ DB `SELECT ciphertext FROM cost_api_credential` → ciphertext only (no plaintext)

---

## 17 · Memory hooks

After ship: save `[[costctrl-shipped-2026-05-31]]` (project memory) with: 5 tables · routes · super_admin gate · crypto-key env name · cron entry · AI wrapping audit result.

---

**Last updated**: 2026-05-31 by `/bigfeature costctrl`
