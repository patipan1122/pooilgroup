# Go-Live Runbook · ClawFleet Unify (2026-06-02)

> Code is DEPLOYED to prod (merge b542eaa on setup · Vercel deploy 8thjzznk0 Ready · all routes verified 307).
> The 3 steps below are **prod DB writes + real data / secrets** — each needs explicit CEO authorization (the auto-mode classifier blocks them by default). Run them in order.

## Status now (LIVE, code-side)
- Unified single menu (double sidebar gone) · A/B group model · 3-way token cross-check (trigger) · LINE Mini App /liff/clawfleet · v1 deleted · F1/F2/F5 anti-fraud intact · 2 audit bugs + 5 dead links fixed.
- **The collect flow shows EMPTY** until groups/exchangers/machines are configured (greenfield). That is expected — do Step 2.

## Step 1 — Apply the CASH-group guard migration (prod DB) ⚠ needs auth
Without it, Type A (CASH, no exchanger) groups get a cosmetic COIN_GROUP_MISMATCH flag (the round still CLOSES — the cash/doll app-checks pass — but it adds review noise).
```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web
npx dotenv -e .env.local -- npx prisma db execute \
  --file supabase/migrations/20260531000001_clawfleet_group_crosscheck_guard.sql \
  --schema prisma/schema.prisma
```
Verify: `SELECT routine_definition FROM information_schema.routines WHERE routine_name='cf_session_close_crosscheck'` contains `exchanger_id IS NOT NULL`.
(Migration 20260521000002 — the base trigger — is already applied since ClawFleet is live.)

## Step 2 — Configure groups / exchangers / machines (prod DB) ⚠ needs auth + real data
The v1 setup UI was deleted; the collect flow READS groups but there is no v2 creator yet. Two paths:
- **Demo/test (fast):** existing scripts seed a working structure so you can immediately test the flow + 3-way cross-check:
  - `scripts/seed-clawfleet-real-branches.ts` — real branch structure
  - `scripts/seed-clawfleet-v2-demo.ts` — demo CLAW machines (v2 model)
  - `scripts/e2e-clawfleet-multigroup.ts` — exercises the A/B multi-group flow end-to-end
  (run with `npx dotenv -e .env.local -- npx tsx scripts/<file>.ts`)
- **Real go-live:** needs the actual structure per branch — which branches have a ตู้แลก (→ TOKEN group, set group.exchangerId), which claws belong to which group, machine codes + QR tokens + initial meters. A small v2 admin "setup" page to create branches/groups/machines is the recommended next build (DEFERRED — flag if you want it now).

## Step 3 — LINE Mini App channel ⚠ needs CEO
Set `NEXT_PUBLIC_LIFF_ID="{channelId}-{liffAppId}"` in prod env (Vercel) so /liff/clawfleet auto-logs-in inside LINE. Without it the route still works via web login. Create the LIFF app in LINE Developers Console → Messaging/Login channel → add LIFF endpoint = `https://pooilgroup.vercel.app/liff/clawfleet`.

## Recommended (audit STAFF persona): pilot 1 branch × 1–2 days before 10-branch rollout
Measure: time/round (target <10 min for a 4-claw group) · form-abandon <5% · review-flag rate <10% after Step 1.

## Deferred (post-pilot, not blocking)
- Photo upload timeout/retry + local draft auto-save (field-network resilience)
- v2 admin setup UI for groups/machines (currently script-only)
- A11y polish (focus rings, semantic tables) · bank-settlement page (code on antifraud branch)
