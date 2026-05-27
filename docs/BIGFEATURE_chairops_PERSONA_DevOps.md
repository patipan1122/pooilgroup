# BIGFEATURE · ChairOps · Persona: DevOps

> **Run:** 2026-05-27 · /bigfeature roundtable
> **Project:** `prj_cgJemvxTdWaUBvPMPoejxCqEs48K` (pooilgroup) · team `aUiG9JmSKt24y6P8o5Og2v63`
> **Vercel plan:** **Pro** (already running 18 crons; Hobby cap = 2 → Pro confirmed · 300s function cap available)
> **Stack:** Next 16.2.4 · Prisma 7.8 · Supabase pooler · Sentry v10 · R2 (S3 SDK) · LIFF 2.28 · `xlsx` 0.18 · `@anthropic-ai/sdk` 0.93 · `@google/genai` 1.52 · Telegram alerts wired

---

## 1 · Deploy strategy per wave

| Wave | Code | Env adds | DB | Deploy step | Owner |
|---|---|---|---|---|---|
| **W0** | XLSX parser · diff UI · drift-engine rewrite · `module-access.ts` line 30 fix · cron handlers no-op safe | none | +5 cols on `chairops.ChairopsBranch` · +1 table `ChairopsBranchDailyRevenue` | preview deploy → CEO smoke → `vercel --prod` | DevOps |
| **W1** | LINE OA webhook · LIFF init · `ChairopsLineChannel` admin paste UI · 4 maid PWA routes · `dashboard-office` | `CHAIROPS_CHANNEL_KEY` (32-hex, AES-GCM) · `NEXT_PUBLIC_LIFF_ID_CHAIROPS` | +1 table `ChairopsLineChannel` (encrypted tokens at-rest) | preview → CEO LIFF self-test → prod | DevOps + CEO |
| **W2** | Gmail poller cron · Anthropic extract · bill UI · COA map · period-close | `CHAIROPS_GMAIL_CLIENT_ID` · `CHAIROPS_GMAIL_CLIENT_SECRET` · `CHAIROPS_GMAIL_REDIRECT_URI` · `CHAIROPS_GMAIL_REFRESH_TOKEN` · reuse `ANTHROPIC_API_KEY` · reuse `R2_*` | +4 tables (`ChairopsVendorBill`, `ChairopsPeriod`, `ChairopsCOAMap`, `ChairopsAdjustmentRequest`) · +1 immutable `PeriodReopenLog` | preview → cron dry-run via `?force=1` → prod | DevOps |
| **W3** | Audit grid · damage-sla cron · leaderboard · OA push templates | none | indexes only | preview → prod | DevOps |

Pool main does **NOT** auto-deploy (`[[feedback-push-not-equals-deploy]]`). Every wave ends with explicit `vercel --prod` after CEO sign-off.

---

## 2 · Feature flagging — **finer than `MODULES_DISABLED`**

`MODULES_DISABLED=chairops` (per `[[modules-disabled-env-killswitch]]`) is too coarse — ChairOps is **already live in prod**; toggling it would kill the office team mid-day. Use layered flags:

```
1. Env kill (full module): MODULES_DISABLED=chairops      ← last-resort rollback
2. Wave flag (env):       CHAIROPS_WAVE1_LINE_OA=on|off   ← hide LINE OA rich menu + LIFF routes
                          CHAIROPS_WAVE2_BILLS=on|off
                          CHAIROPS_WAVE2_GMAIL_POLL=on    ← gates the cron handler entry
                          CHAIROPS_WAVE3_AUDIT_GRID=on
3. Per-tenant grant:      lib/auth/module-access.ts already has `userHasModuleAccess`
```

Implementation: 3-line helper `lib/chairops/flags.ts` reads `process.env.CHAIROPS_WAVE${N}_*` · default off · server-only · no client bundle.

**Pilot rollout (Wave 1):** flag `on` only after CEO confirms 1 branch test passes. Gmail poller (W2) stays `off` until OAuth grant complete.

---

## 3 · Migration safety

Sequence for **every** wave (per `[[pool-schema-drift-2026-05-21]]` + `[[migration-repair-without-real-apply-trap]]`):

```bash
# 1 — local: edit prisma/schema.prisma
# 2 — local diff vs prod (read-only sanity)
DATABASE_URL=$PROD_DIRECT_URL npx prisma migrate diff \
  --from-url "$PROD_DIRECT_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/chairops_W0.sql

# 3 — review SQL by hand (look for unexpected DROP)
grep -iE "DROP |ALTER .* DROP" /tmp/chairops_W0.sql   # must be empty

# 4 — save into supabase/migrations
mv /tmp/chairops_W0.sql supabase/migrations/$(date +%Y%m%d%H%M%S)_chairops_w0_costs_revenue.sql

# 5 — apply via psql against DIRECT_URL (NOT pooler, NOT prisma db push)
psql "$PROD_DIRECT_URL" -f supabase/migrations/<file>.sql

# 6 — sync Prisma tracking table only
DATABASE_URL=$PROD_DIRECT_URL npx prisma migrate resolve --applied <migration_name>
```

**Hard NO:** `prisma db push`, `prisma db push --accept-data-loss`, `supabase migration repair` alone (only touches `_prisma_migrations` tracking — actual SQL never runs). For RLS or plpgsql RPCs, confirm type-match exactly per `[[reserve-quota-int-bigint-bug]]`.

---

## 4 · Cron monitoring (already wired — extend it)

`lib/cron/runner.ts` ships `runWithMonitor()`: idempotency check on `cron_runs` table, `?force=1` bypass, Telegram alert via `sendToAdminChat` on uncaught error. **All 3 ChairOps crons should wrap their handlers in `runWithMonitor`**. Current `recompute-drifts/route.ts` does NOT — wrap it in Wave 0.

```ts
// app/api/chairops/cron/recompute-drifts/route.ts
export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;
  return runWithMonitor("chairops-recompute-drifts",
    () => evaluateAndEmitAlerts(), { req });
}
```

**Daily verify (manual):** `select cron_name, status, started_at, finished_at from cron_runs where run_date=current_date order by started_at desc;` — fold into `/api/cron/morning-brief` Telegram digest already in place. Add a "last 24h cron failures" line.

**Vercel function cap:** Pro = 300s. Drift recompute over 30 branches × ~90 day window = ~50ms × 2700 rows = well under 5s. Safe. Cron-level `maxDuration = 60` per handler is fine.

---

## 5 · External dependency monitoring

| Dep | Failure mode | Detection | Alert |
|---|---|---|---|
| StarThing portal (XLSX) | CEO upload manual — no live cron | Upload UI shows parse errors | toast + Sentry breadcrumb |
| LINE OA Messaging API | 401 invalid token · 429 rate · 5xx | Catch in `sendLineMessage` · log row in `chairops_line_outbound` w/ status | Telegram alert on 3 consecutive 5xx |
| Gmail API | OAuth refresh expired · quota | `cron/bill-ingest` returns `ok:false` · runWithMonitor flags it | Telegram + email CEO |
| Anthropic API | 529 overloaded · 400 schema · cost spike | wrap in retry-with-backoff (max 2) · log `chairops_ai_calls` | Telegram on 3 fails in 1h |
| R2 | 5xx put · presign expire | S3 SDK throws · log + retry once | Sentry + Telegram |
| Supabase pooler | conn cap (15 transactions) | Prisma `P1001` / `P1017` | Sentry alert rule |

Sentry v10 is wired (`next.config.ts` + `@sentry/nextjs` 10.53). Add Sentry **Alert Rules** UI:
1. `event.level:error AND tags.module:chairops` → notify Slack/Telegram
2. `transaction.op:cron AND transaction.status:failure` → Telegram

---

## 6 · Secrets — full env list

| Var | Wave | Where used | Notes |
|---|---|---|---|
| `DATABASE_URL` · `DIRECT_URL` | existing | Prisma | already set |
| `CRON_SECRET` | existing | all cron routes | already set per `lib/chairops/auth/cron-secret.ts` |
| `ANTHROPIC_API_KEY` | W2 | bill extract | reuse Recruit's key |
| `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` | existing | bill PDF + photos | reuse — same bucket, prefix `chairops-bills/` |
| `CHAIROPS_CHANNEL_KEY` | W1 | AES-256-GCM for LINE channel tokens | **new** · 32-byte hex · pattern from Recruit per `[[recruit-omnichannel-prod-2026-05-23]]` |
| `NEXT_PUBLIC_LIFF_ID_CHAIROPS` | W1 | LIFF init in `/m/*` | from LINE OA console |
| `CHAIROPS_GMAIL_CLIENT_ID/SECRET/REDIRECT_URI/REFRESH_TOKEN` | W2 | Gmail poller | OAuth user-grant (D-NEW-D default) · refresh-token long-lived |
| `CHAIROPS_WAVE1_LINE_OA` · `CHAIROPS_WAVE2_BILLS` · `CHAIROPS_WAVE2_GMAIL_POLL` · `CHAIROPS_WAVE3_AUDIT_GRID` | W1-W3 | feature flags | `on`/`off` literal |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_ADMIN_CHAT_ID` | existing | cron alerts | already set |
| `SENTRY_*` | existing | error tracking | already set |
| `LINE_NOTIFY_TOKEN_*` | legacy | EOL — keep till W1 ships | remove after migration |

Set via `vercel env add <NAME> production` then `preview` and `development`. Never commit. Verify with `vercel env ls | grep CHAIROPS`.

---

## 7 · Rollback procedure (per wave)

```bash
# Step 1 — confirm cwd  (per [[verify-cwd-before-vercel-prod]])
pwd && cat .vercel/project.json
#   → must show projectId prj_cgJemvxTdWaUBvPMPoejxCqEs48K

# Step 2 — instant flag flip (no redeploy needed)
vercel env rm  CHAIROPS_WAVE1_LINE_OA production
vercel env add CHAIROPS_WAVE1_LINE_OA production   # value: off
vercel deploy --prod --prebuilt          # re-publish env without rebuild

# Step 3 — full module kill (last resort)
vercel env add MODULES_DISABLED production         # value: chairops
vercel deploy --prod --prebuilt

# Step 4 — code revert
git log --oneline -10                              # find pre-wave hash
git revert <hash>..HEAD                            # creates revert commit
git push                                           # NOT a deploy yet
vercel --prod                                      # explicit deploy

# Step 5 — DB revert (rare — only if migration broke things)
psql "$PROD_DIRECT_URL" -f supabase/migrations/rollback/<wave>.sql
npx prisma migrate resolve --rolled-back <name>

# Step 6 — LINE OA channel revoke (W1 rollback only)
#   LINE Console → Channel settings → Issue new token → old token auto-revoked
#   Update CHAIROPS_LINE_CHANNEL_TOKEN_ENCRYPTED via admin UI
```

**Every wave PR ships with a `supabase/migrations/rollback/W<N>.sql`** that reverses the forward migration.

---

## 8 · Pre-deploy checklist

```bash
# Always from /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
pwd && cat .vercel/project.json | grep projectId    # MUST be pooilgroup
git status                                          # clean
npx prisma generate
npx tsc --noEmit                                    # NOTE: next.config has ignoreBuildErrors=true → tsc is the real gate
npx eslint .
npm run build                                       # next build
# smoke
curl -s https://pooilgroup.vercel.app/api/healthz | jq .
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://pooilgroup.vercel.app/api/chairops/cron/recompute-drifts?force=1 | jq .
# only THEN
vercel --prod
# post-deploy
curl -s https://pooilgroup.vercel.app/chairops -I | head -1   # 200/302 not 500
```

Skipping any of these = `[[feedback-real-world-verification]]` violation.

---

## 9 · Cost projections

| Item | Quantity | Unit cost | Monthly |
|---|---|---|---|
| Vercel Pro | flat | $20/seat | $20 (already paid) |
| Vercel cron exec | 18 crons × ~30 inv/day × <1s avg | within Pro 1000 GB-hr | $0 incremental |
| Anthropic Sonnet (bill extract) | ~30 bills/mo · ~3 input + 1 output kT × $3+$15/MT | — | **~$0.60/mo** |
| Anthropic Sonnet (cleanliness optional) | opt-in only · ~50/mo | — | **~$1/mo** |
| R2 storage (bills) | 30 bills/mo × 200KB × 12mo × 7yr = ~500MB | $0.015/GB | **~$0.01/mo** (free tier covers) |
| R2 Class A ops (writes) | ~5K/mo | $4.5/M | **~$0.02** |
| R2 egress | ~5GB/mo | $0 (R2 free egress) | $0 |
| LINE OA push | 30 maids × ~5 push/day × 30 = 4,500/mo | Light plan (free 200) · Stand plan THB 1,200/15K | **~THB 1,200/mo** (~$34) once past 200 free |
| Supabase Pro (eventually) | shared w/ all Pool modules | $25 | $25 (already paid) |

**Total ChairOps incremental: ~$36/mo** (~THB 1,250). LINE OA is the dominant cost — propose throttling: only EOD-summary + critical alerts via push; routine updates via webhook responses (free).

---

## 10 · Single points of failure + mitigations

| SPOF | Mitigation |
|---|---|
| Vercel project deploy lock (CEO offline · only seat) | Add 1 invitee w/ deploy role |
| Supabase pooler (15 conn) saturating from 3 modules' crons all 22:00 | Stagger ChairOps crons — already 22:00 / 22:30 / 01:00 ✅ |
| LINE OA token leak | AES-256-GCM at-rest · pattern proven in Recruit |
| Gmail OAuth refresh expire (180d if no use) | Daily ping cron · re-prompt CEO if expired |
| StarThing format change | Diff-preview UI surfaces unknown columns · CEO sees before commit |
| `next.config.ts` `ignoreBuildErrors:true` masks real type errors | **Wave 3 task:** fix DocuFlow/Recruit type errors · remove flag · enforce tsc in CI |

---

## 11 · Wave 0 safety verdict

**YES — safe to deploy today.** ChairOps prod uses minimal traffic (CEO + 1-2 office users); 5 risk fixes are additive (no breaking DB drop), `module-access.ts` line 30 only adds 3 strings to a whitelist (zero blast radius), 2 schema additions are nullable. Run sequence: branch → preview → CEO XLSX smoke → migration via psql → prod deploy → curl smoke.

**END · DevOps persona · 2026-05-27**
