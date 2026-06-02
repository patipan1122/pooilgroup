# BugSolve · inbox · 2026-06-01

## §summary (Thai)
- Status: ✅ 5 code-safe fixes shipped (commit 2d598be → setup/prod) · ⚠️ 2 migrations CEO-run · 🔴 4 operational blockers (Meta/Vercel) need CEO.
- Audit-fed mode — used docs/AUDIT_inbox_2026-06-01.md as triage (no 25-sim re-crawl).
- The fixes don't make FB messages flow by themselves — they make the failure VISIBLE + honest, fix a token leak, and stop the bot answering as the wrong business. The actual unblock is operational (see §next).

## §bugs-fixed (commit 2d598be)
| # | file | fix |
|---|---|---|
| BE-01/03/06 | webhooks/inbox/facebook-app + line | loud logs distinguishing secret-missing vs sig-mismatch vs unknown-page → "zero messages" now diagnosable in Vercel logs |
| BE-02 | lib/inbox/channel-actions.ts | FB import sets status='error' + metadata.subscribeError on subscribe failure (was always 'active' = silent lie) |
| SEC-04 | channel-actions + facebook-app | page token → Authorization header (was ?access_token= in URL → log/referrer leak) |
| SA-03 | inbox/_components/conversation-list.tsx | empty-state copy honest (was "ไม่พบตามที่กรอง" with no filter → CEO thought broken); points to ตรวจการเชื่อมต่อ |
| SA-04 | lib/inbox/bot/{ai,engine}.ts | AI fallback persona uses channel businessName (was hardcoded "เก้าอี้นวด" for all incl hotel) |

## §bugs-deferred
**⚠️ CEO-run migrations** (need dedupe check first):
- SA-01: add index `InboxMessage(channelId, externalId)` — idempotency lookup unindexed.
- SA-02/SEC-02: add unique `InboxChannel(platform, externalId)` — closes cross-org page collision (dedupe existing rows first).

**🔴 Operational (Meta / Vercel — not code):**
1. Confirm `FACEBOOK_APP_SECRET` in prod (`vercel env ls`) — top root-cause suspect for zero-messages.
2. Rotate leaked secrets (FB app secret + 43 page tokens + ANTHROPIC key) — outstanding since 2026-05-30.
3. FB App Review → Live mode + pages_messaging + business verification + build data-deletion callback endpoint (URL filled, no route in code).
4. Re-connect pages with permanent System User token (paste-JSON tokens expire ~1h).

## §next-actions (CEO)
- After deploy: open /inbox/settings/channels → "ตรวจการเชื่อมต่อ" on โรงแรมมิกส์ → read verdict (token valid? subscribed? messages field?). That + Vercel function logs (now loud) will pinpoint the exact break.
- OWNER recommendation (from audit): prove ONE page end-to-end with System User token before trusting the 40-page bulk; then App Review; then expand.

## §lessons-this-run
- 💚 audit-fed bugsolve (skip 25-sim crawl, fix from audit triage) is efficient + precise for a known-area bug.
- 💔 the highest-impact root cause (app secret / App Review) is operational, not code — bugsolve can only add visibility + honesty, not "fix" it. Important to set CEO expectations.
- 🔧 next: a cron health-check (call subscribed_apps + debug_token per channel daily → mark status + LINE alert) would turn the manual button into proactive monitoring.
