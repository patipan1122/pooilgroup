# AUDIT — inbox (FB inbound pipeline + production-readiness) · 2026-06-01

> /auditbigteam focused re-audit (SA·BE·SRE·SEC) · baseline = audit-inbox-2026-05-30
> Trigger: 40+ FB pages connected, ZERO messages arrive (even app-admin's own test). No feature code written here.

## §1 Executive summary — WHY zero messages

Strong cross-persona consensus: the matching/ingest plumbing is CORRECT (channel found by `externalId === entry.id`, org-scoped, idempotent). The break is at the **webhook edge + the subscribe step + total lack of observability**:

1. 🔴 **`FACEBOOK_APP_SECRET` missing/wrong in prod** → `verifyAppSignature` returns false → **every** FB webhook POST gets 401 *before touching the DB*. Explains "zero messages, ALL pages, incl. admin" perfectly (`facebook-app/route.ts:44,57`; `.env.example` has no FB keys). **CONFIRM FIRST:** `vercel env ls` + function logs (do we see 401s, or no requests at all?).
2. 🔴 **Pages never actually subscribed.** Paste-JSON import used ~1-hour page tokens; `subscribePageWebhook` threw → caught into an `errors[]` shown only as a toast/console, while `status` stays `"active"` (deceiving). So FB has no subscription → never sends events (`channel-actions.ts:483-494`).
3. 🔴 **No observability.** `lastEventAt` only updates *after* a channel matches — a 401 or unknown-page event leaves zero trace. The CEO (and we) literally cannot tell if FB is calling us. (`facebook-app/route.ts:88,101`)
4. App still **Development mode** → real customers blocked regardless (admin messages would still arrive if 1-3 were fixed → that they don't confirms 1-3).

## §2 Sign-off

| Persona | Status | Blockers |
|---|---|---|
| BE | 🔴 BLOCKED | silent 401 drop (BE-01), subscribe-fail not persisted + status="active" lie (BE-02), no webhook observability (BE-03) |
| SRE | 🔴 BLOCKED | no failure-visibility (SRE-1/3), App Review + Live mode needed (SRE-2), no token-expiry/refresh for 40 pages (SRE-4), missing data-deletion endpoint |
| SEC | 🔴 BLOCKED | leaked secrets (FB app secret + 43 tokens) STILL not rotated since 2026-05-30 (SEC-01), cross-org: no unique(platform,externalId) (SEC-02), token in URL query (SEC-04) |
| SA | 🟡 CONDITIONAL | over-scoped (40 pages before inbound works); missing indexes (SA-01/02); empty-state copy bug (SA-03); AI persona hardcoded chairops (SA-04); budget org-level not per-business (SA-05) |
| OWN | 🟡 | minimum-viable-path: prove 1-2 pages end-to-end before bulk-40 |

## §3 Root cause to confirm (ordered)
1. `FACEBOOK_APP_SECRET` prod env — check `vercel env ls`. (explains 100%)
2. Per-page `subscribed_apps` — use the new health-check button per page.
3. App-level webhook callback verified + `messages` field subscribed in FB dashboard.

## §4 Findings ledger
| ID | Sev | Title | Where | Auto-fixable? |
|---|---|---|---|---|
| BE-01/03 | 🔴 | webhook drops (401/unknown-page) leave zero trace — no observability | facebook-app/route.ts:44,88,101 | ✅ add logging/counters |
| BE-02 | 🔴 | subscribe failure not persisted; status stays "active" (lie) | channel-actions.ts:483-494 | ✅ set status=error + store err |
| SEC-01 | 🔴 | leaked FB app secret + 43 page tokens not rotated | ops | ❌ CEO rotates in Meta |
| SEC-02/SA-02 | 🔴 | cross-org: no unique(platform,externalId) on InboxChannel | schema:4360 | ⚠️ migration (dedupe first) |
| SEC-04 | 🟡 | page token passed in URL query (`?access_token=`) → log/referrer leak | channel-actions.ts:238,251; webhook profile fetch | ✅ move to Authorization header |
| SA-01 | 🟡 | idempotency lookup unindexed (scans every inbound msg) | ingest.ts:43; schema:4397 | ⚠️ index migration |
| SA-03 | 🟡 | empty-state says "ไม่พบตามตัวกรอง" even with no filter = the CEO's "ไม่พบบทสนทนา" | conversation-list.tsx:35 | ✅ copy fix |
| SA-04 | 🟡 | AI fallback persona hardcoded "เก้าอี้นวด" for all businesses (incl hotel) | bot/ai.ts:64 | ✅ pass businessTag |
| SA-05 | 🟡 | AI budget org-level ($50/mo) not per-business → one page burns org budget | bot/ai.ts:10,14 | ⚠️ moderate |
| SRE-2 | 🔴 | FB App in Development mode → no real customers | Meta | ❌ App Review |
| SRE-4 | 🟡 | no token-expiry tracking; 40 short-lived tokens = re-paste hourly | schema InboxChannel | ⚠️ use System User permanent token |
| data-deletion | 🔴 | App Review requires a working data-deletion callback endpoint — URL filled but NO route in code | — | needs build |

## §5 OWNER minimum-viable-path (recommended)
1. **Confirm `FACEBOOK_APP_SECRET` in prod** (likely root cause) — 2 min.
2. **Prove ONE page end-to-end**: re-connect Talay Town with the **permanent System User token** (set up this morning) → health-check shows subscribed+messages → admin test message arrives. Don't trust bulk-40 until one works.
3. **Then App Review** (business verify + privacy + data-deletion endpoint + pages_messaging) for real customers.
4. Only after a vertical works → expand. Don't bulk-import 40 pages before inbound is proven.

## §6 Next: /bigsolvebug auto-fixes the ✅ items (observability, status-honesty, empty-state, token-header, AI persona); ⚠️ index/unique need CEO-run migration; ❌ are operational (Meta/Vercel env). Persona files: /tmp/audit_inbox2_phase1_{BE,SRE,SEC,SA}.md
