# BIGFEATURE recruit-onboarding — Persona: DevOps

**Feature:** ระบบรับพนักงานใหม่ออนไลน์ — one permanent, fully public, unauthenticated URL in Recruit that collects real PII (Thai ID numbers, ID card photos, live selfie capture), a signed employment contract, and can create real production `User` records pending HR approval.
**Scope of this doc:** deploy strategy, monitoring, rollback/kill-switch, env/secrets. Not re-litigating legal/UX/schema — those are locked, and covered by the SA/BA/Legal/UX docs already in this directory.

**Note on spec drift (confirmed, not my finding — cross-referencing PM):** the in-repo `docs/WORKSHOP_recruit-employee-onboarding.md` (2026-09-21 revision) describes a **6-digit reference-code gate** and **typed-name signature**, but the LOCKED SPEC this `/bigfeature` run was actually given — and which `BIGFEATURE_recruit-onboarding_PERSONA_PM.md` §0 independently confirmed by re-reading the brief — has **zero gate at all** (genuinely public, no code, no token) and **drawn signature + live selfie capture**. I'm writing this doc against the **locked spec** (no gate), because that is the higher-risk version and the one actually authorized. Everything below — especially the rate-limiting and kill-switch sections — would need to be re-read if the team instead ships the WORKSHOP.md variant with a code gate. This divergence is the single most important fact for DevOps risk sizing here: a code-gated form has a natural throttle point (wrong-code attempts); a gateless form does not.

---

## 1. Deploy plan

### 1.1 Route/feature isolation — confirmed clean

This feature is structurally easy to isolate because almost everything is **new tables + forked components**, not edits to shared code:

- New Prisma models (new migration): onboarding invite/staging, document staging, consent record — none of these touch `User`, `RecruitApplication`, `Document`, or `PersonDocument` except through new, nullable/additive columns.
- New routes: a new public page (fixed URL, e.g. `app/recruit/onboard/page.tsx`), a new signing route (existing `app/sign/[placementId]/page.tsx` is hard-gated on `requireSession()` per PM's read — not reusable as-is, needs a parallel route), new API endpoints for submit/upload/sign, and a new HR review page under the existing `app/(admin)/recruit/*` tree.
- Component reuse is **forked, not shared**: `public-form-renderer.tsx`, `signer-interface.tsx`'s signature-pad chrome, and `components/playland/face-capture.tsx` all get copied/adapted rather than parameterized in place — this is the right call operationally, because it means a bug in the new onboarding flow cannot regress the existing `/apply/[slug]` applicant flow or the existing DocuFlow signing flow that other modules depend on.

**Only two genuinely cross-cutting touch points exist, and both need extra scrutiny before merge, not just the new feature's own testing:**

1. **Core auth/session guard** needs a new check blocking login while `User.status = pending_verification`. This is shared code every login in the app goes through (ChairOps maid login, LedgerLine login, admin login, etc.). This is the highest-blast-radius line in the whole feature — a mistake here doesn't just break onboarding, it can lock out or wrongly admit users across every other module. **Deploy checklist must include a regression pass on at least one login flow from a different module**, not just the new onboarding flow.
2. **Google Drive upload** reuses the org's shared OAuth connection (`lib/chairops/storage/drive.ts` → `ChairopsDriveConnection`, keyed by `orgId`) that ChairOps, LedgerLine, and the existing Recruit `/apply` flow already depend on. No new credential is introduced (see §4), but this feature becomes a 4th consumer of that single connection — see §4 for the blast-radius note.

### 1.2 `/verify` convention — applies here, and one extra gate matters more than usual

The skill listing confirms `verify: Full pre-deploy verification (typecheck + lint + build + curl) — never claim "done" without this`, and it's not just a convention — it's **mechanically enforced**. `~/.claude/hooks/verify-gate.py` is a `PreToolUse(Bash)` hook that blocks `git push` to `setup`/`main`/`master` unless the pushed commit's SHA matches a `.claude-verified` marker written by a passing `/verify` run (feature-branch pushes are exempt — only prod-branch pushes are gated). So the standard sequence (commit → `/verify` → push) is not optional here; a raw `git push origin HEAD:setup` without it will hard-fail at the hook, independent of anything DevOps does manually.

**One thing specific to this feature makes the build gate load-bearing in a way most features aren't:** `package.json`'s `build` script is `prisma generate && node scripts/check-prisma-table-map.mjs && node scripts/check-schema-applied.mjs && next build`. `check-schema-applied.mjs` **hard-fails the Vercel build** if the Prisma schema references tables that haven't been applied to the production DB yet (confirmed pattern from project memory — this exact gate has bitten this repo before). This feature adds 2-3 brand-new tables. **Sequencing must be: apply the migration to prod DB first (`prisma migrate deploy` / `prisma db execute --file`, per the `prisma db execute` v7 convention already in memory), then push the code that references those tables** — not the other way around, and not "migrate + push code in the same breath and hope." `/verify`'s local `next build` will catch a schema mismatch before push regardless, but it's worth calling out explicitly in the deploy runbook so whoever executes it doesn't reorder the two steps under time pressure.

### 1.3 Branch/merge posture — confirmed correct, and should be *stricter* than usual here

The established practice (commit to an isolated branch → push → hold merge-to-`setup` for explicit CEO go-ahead) is the right posture here, and if anything this feature is a textbook case for **not even auto-merging once CEO says "go"** — because of the legal-content risk flagged in the workshop's own risk list (`AUDIT`/workshop risk #1: contract clauses need light legal review before this goes live; any clause shipped un-reviewed risks every contract signed from day one being void). Recommend treating "merge to setup" and "flip the public form live" as **two separate, independently reversible approvals** rather than one:

- **Approval 1 — merge to `setup`:** code is correct, verified, deployed, but the public route itself defaults to **off** (see kill-switch, §3). This can happen as soon as engineering + `/verify` are done, without waiting on legal.
- **Approval 2 — flip the DB toggle to make the URL live:** happens only after (a) light legal review of the clause wording is done, and (b) the open CEO decisions in the workshop (retention window, etc.) are actually answered — not just "code is ready."

This separation means a legal-content fix, if one is needed after merge but before anyone has actually seen the form, costs a content edit + toggle, not a rollback.

### 1.4 "Ready to deploy, awaiting go-ahead" — concrete checklist

- [ ] `tsc` / typecheck clean
- [ ] `eslint` clean
- [ ] `next build` succeeds **against the prod-shaped schema** (i.e., migration already applied to prod DB, not just local/dev DB — see §1.2)
- [ ] `/verify` run completed and its marker matches the commit being pushed (mechanically required by the hook regardless)
- [ ] Feature branch pushed to `origin`; **not** merged to `setup`
- [ ] New public route confirmed to default to the "closed/off" state end-to-end (kill-switch tested in the OFF position before anything is merged, not just designed)
- [ ] Rate limits wired on all 3 public-facing endpoints (submit, document upload, sign) — see §2
- [ ] Regression check on a login flow from a module *other than* Recruit (auth-guard touch point, §1.1)
- [ ] Sentry confirmed still scrubbing PII on a test error thrown from the new routes specifically (don't assume — verify against the actual new route paths, since scrubbing is regex-based on event content, not route-aware)
- [ ] CEO has answered the workshop's open questions that gate a *responsible* launch (retention window for un-approved submissions, light-legal-review sign-off on clause wording) — these block **Approval 2** (flip live), not **Approval 1** (merge)
- [ ] CEO explicit go-ahead obtained for the toggle flip specifically, separate from and after the merge

---

## 2. Monitoring

### 2.1 What to actually watch, mapped to what already exists

| Signal | Existing hook-in point | Gap |
|---|---|---|
| Errors / exceptions on the new routes | Sentry, already wired server+client (`instrumentation.ts`, `instrumentation-client.ts`) with a PII scrubber that already regex-matches Thai national ID (13-digit and dashed formats), phone, email, and card numbers before events leave to Sentry SaaS | None — this is a direct, lucky fit for exactly the PII this feature handles. Just confirm it fires on the new route paths (checklist above). |
| Submission volume/rate | Nothing generic exists (no APM/analytics beyond Sentry) | Cheapest correct fix: log each successful submit as an audit-log row (see `lib/audit/log.ts`'s `AuditAction` enum pattern — add 2-3 new action types, e.g. onboarding-submit, onboarding-doc-upload-failed) and surface a same-day count on the HR dashboard the feature is already building (Must-have per workshop — "list + status" screen). This is the ladder principle: the counter tile rides on infrastructure being built anyway, no new service needed. |
| Failed Drive uploads | `lib/recruit/drive.ts` already `console.error`s on failure (`[recruit drive] upload failed`) — that reaches Sentry via the server instrumentation's error capture, but only if the failure actually throws/logs through a path Sentry sees, not a swallowed `return null` | The existing `/apply` route treats Drive failure as best-effort (falls back to R2, `{fallback:true}`). **This feature explicitly has no R2 fallback for ID documents** (Drive-only per the CEO's storage decision) — so a Drive failure here means a legitimate submission can't complete, not a silent degrade. Recommend the failure path here specifically calls `Sentry.captureMessage` (not just `console.error`) so it's visible as an event, not just a log line, and consider an audit-log row too so it shows up in the HR-facing counter. |
| Failed signature/selfie captures | `components/playland/face-capture.tsx` (existing, being forked per PM's investigation) — camera-permission-denied / capture failures are client-side UX states today, not currently instrumented as events | Add client-side Sentry breadcrumbs/events on capture failure (camera permission denied, capture upload failure) — cheap addition while forking the component anyway. |
| Bot-abuse spike | **No existing generic bot-detection.** The form already reuses a honeypot field (confirmed present in `public-form-renderer.tsx` per PM's read) — that's real, cheap, and should carry over to the fork. Beyond that, the only signal is the rate limiter itself. | Rate-limit trip counts (429s) per endpoint per hour is the practical proxy metric for "something abnormal is happening" on a gateless public form — recommend this specifically be one of the counters on the HR/DevOps-visible dashboard, not just silently enforced. A sudden climb in 429 counts is the earliest available signal of a flood, given there's no reference-code layer to watch wrong-attempts on instead. |

### 2.2 Cron monitoring — reuse, don't build

The workshop's proposed "onboarding janitor" cron (expire stale invites, purge retained-past-window PII, remind HR) should use the existing `lib/cron/runner.ts` (`runWithMonitor` / `withCronGuard`) pattern that every other cron in this repo already uses — it gives idempotency (`cron_runs` table, skip if already succeeded today), and **automatic Telegram alert to the admin chat on uncaught failure** (`sendToAdminChat`, via `lib/telegram/send.ts`) for free. This is not a new integration to build, it's the same wrapper `docuflow-expiry`, `morning-brief`, etc. already use. Add the new cron path to `vercel.json`'s `crons` array following the existing per-module path convention (e.g. `/api/recruit/cron/onboarding-janitor`).

### 2.3 What's genuinely new/unproven here

Everything above reuses existing infra **except** the volume/rate-of-abuse dashboard tile and the Drive-failure-as-visible-event change — both are small, additive, and should be built alongside the feature rather than treated as a later nice-to-have, because this is the first fully gateless, unauthenticated, PII-collecting route in the app (the closest precedent, `/apply/[slug]`, is public but low-consequence — a resume upload, not a signed contract + national ID + selfie).

---

## 3. Rollback / kill-switch plan

### 3.1 No existing generic mechanism — confirmed by direct search

There is no `middleware.ts` at the app root, no `FeatureFlag` model in `prisma/schema.prisma`, and no `MAINTENANCE_MODE`-style env var anywhere in the codebase (all checked directly, zero hits). The closest existing precedent is ad hoc and per-feature: the existing `/apply/[slug]` flow checks `posting.status !== "OPEN"` at request time in `app/api/recruit/upload-drive/route.ts` and returns a friendly Thai error — a DB column checked live, no deploy required to flip. That's the right pattern to copy, not a generic system to plug into.

### 3.2 Recommendation: a real, permanent DB toggle — not an env var, not a code flag

Given the URL itself is explicitly meant to be **permanent** (this isn't a beta feature that gets its flag deleted in three months), the off-switch needs to be equally permanent-grade infrastructure, not a throwaway hack:

- A single boolean (e.g. on a small `RecruitOnboardingSettings` row, or reuse whatever settings table the SA doc lands on) checked at the top of: (a) the public landing page, (b) the submit API, (c) the document-upload API, (d) the sign API. All four, not just the page — a bot or a curious link-sharer can hit the APIs directly without ever loading the page.
- **Why DB over env var:** an env var flip on Vercel requires a redeploy to take effect reliably (or at minimum an env-var-change + redeploy cycle) — slower than the incident deserves, and per this project's env-namespacing discipline (RULE J), a boolean toggle isn't secret material anyway, so there's no reason to route it through env vars at all. A DB-backed toggle takes effect on the very next request, with no deploy, no `/verify` gate, no hook — the fastest safe path from "someone notices a problem" to "the public form stops accepting new submissions."
- When off: show a static Thai message ("ระบบปิดปรับปรุงชั่วคราว — ติดต่อ HR โดยตรง") rather than a 404/500 — a candidate who has the (bookmarked, since it's permanent) link shouldn't hit a broken page during a routine incident.

### 3.3 Handling legitimate in-flight submissions when the switch flips

This is where the feature's own design (from the SA/BA docs, cross-referenced) does DevOps a favor: submissions are staged in dedicated new tables, not written directly into `User`/`Document`/`PersonDocument`, and `User` creation is gated behind a **separate, manual HR-approval step** rather than happening automatically at signing (per PM's confirmation of the locked spec). That means:

- A candidate mid-form when the switch flips loses nothing beyond "can't submit right now" — their draft autosave (client-side) is unaffected, and once the switch flips back on they can resume and submit normally.
- A candidate who already fully submitted+signed before the switch flipped is **already sitting safely in the staging tables** regardless of the toggle's current state — the toggle only gates the public-facing *intake* endpoints, not HR's ability to review and approve what's already been collected. HR can keep processing the backlog with the public form switched off.
- The one thing the toggle does **not** protect against by itself: a Drive-quota-exceeded scenario specifically affects uploads that are already mid-flight when it happens (a candidate who's filled in the form and is now uploading their ID photo when quota is hit). Recommend the upload failure path (§2.1) surface a clear "ลองใหม่อีกครั้งภายหลัง" message and preserve the candidate's already-entered form data via the existing draft-autosave mechanism, so a quota incident costs a retry, not a lost submission.

### 3.4 Complementary, faster-but-coarser option worth a 5-minute check

For a genuine flood (not just "something's wrong, pause it") — Vercel plans above Hobby typically offer some form of edge-level rate limiting / Attack Challenge Mode that can throttle traffic to a specific path before it ever reaches the app (and therefore before it ever reaches the DB-backed rate limiter discussed in §3.5). I can't confirm from the repo whether this project's Vercel plan has that available — **worth a quick check of the Vercel dashboard/plan tier**, since if it's available it's a genuinely faster kill mechanism than any application-level toggle for a raw-volume attack (nothing to deploy, nothing to query, blocks at the edge).

### 3.5 One scaling flag inherited from the PM's investigation, worth restating here because it's squarely a DevOps concern

`lib/rate-limit/index.ts`'s own header comment says it's a DB-backed limiter sized for "Phase 1 (30 สาขา ~200 users)" and recommends Redis/Upstash above ~1000 req/s. Every other consumer of this limiter today is internal-traffic-shaped (login attempts, an existing resume-upload endpoint gated behind a still-open job posting). **This feature is the first time that limiter sits behind a route with zero gate, zero auth, and a permanent public URL** — a materially different threat shape. It'll work fine at expected legitimate volume (a handful of new hires a month, per the workshop's own success-metric framing), but if this route gets found and hit by a scraper/bot flood, each rejected request still costs a DB round-trip (a `SELECT count` before the 429), which is a real, if modest, cost/load concern on a Postgres instance that's also serving the rest of the app. Not a blocker for launch — but worth a note that if abuse monitoring (§2.1's 429-count tile) ever shows sustained high volume, the fix is "move this specific route's limiter to Redis/Upstash" or "push the block to the edge (§3.4)," not "the app is fine, ignore it."

### 3.6 Legal-wording-bug scenario specifically

Because the contract template is meant to be version + content-hash-snapshotted at signing time (per the workshop's consensus decisions, confirmed consistent across the other persona docs), a wording fix made *after* the bug is found does not retroactively touch already-signed contracts — good, no rollback of historical data needed there. The kill-switch's job in this scenario is narrower and simpler than it sounds: flip the DB toggle off the instant a wording bug is reported, fix the template content (a data/content change, not a code deploy), get the light-legal re-review, flip back on. No code rollback required for this specific failure mode.

---

## 4. Environment/secrets concerns

### 4.1 Google Drive — no new credential needed

Confirmed by reading `lib/recruit/drive.ts` and `lib/chairops/storage/drive.ts` directly: the existing `app/api/recruit/upload-drive/route.ts` already uploads applicant files to the org's Google Drive today, using:

- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — the shared OAuth app credentials
- `CHAIROPS_DRIVE_CRYPTO_KEY` — AES-256-GCM key that encrypts the org's stored Drive refresh token (`ChairopsDriveConnection` table, keyed by `orgId`)

This is a **deliberately shared connection by design** — the code's own comment states it's "Exported so other modules (LedgerLine) can REUSE this same Google connection... instead of a separate one," and Recruit's existing `/apply` flow already depends on it. **This new onboarding feature needs no new Drive credential or scope** — it's simply a 4th consumer (ChairOps, LedgerLine, existing Recruit apply, and now onboarding) of the exact same per-org OAuth connection, and can reuse `lib/recruit/drive.ts`'s `uploadApplicantFileToDrive` pattern directly (with its own new MIME/size allowlist constant, per the other personas' findings — not the existing `ALLOWED_FILE_MIMES` that `/apply` depends on).

### 4.2 Flag, per RULE J, even though this feature doesn't introduce the problem

`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `CHAIROPS_DRIVE_CRYPTO_KEY` are **not** namespaced to a single program despite being ChairOps-prefixed/generic — they're already load-bearing for 3 existing modules before this feature adds a 4th. This is pre-existing infrastructure debt this feature inherits, not something it creates, and re-namespacing it now would be a much larger, riskier refactor than this feature's own scope justifies (it would require re-encrypting every org's stored refresh token under a new key across ChairOps + LedgerLine + Recruit simultaneously — exactly the failure mode RULE J itself warns about, from the 2026-06-08 incident where a generic-env change silently bricked an unrelated program's decrypt path). **Recommendation: do not touch these three vars as part of this feature — just be aware that after this ships, a future rotation/change of any of them has a larger blast radius (now 4 features, not 3), and that fact should live in whoever owns the next Drive-credential rotation's checklist, not be silently rediscovered.**

### 4.3 New env vars actually needed for this feature: none confirmed required

- Cron auth reuses the existing shared `CRON_SECRET` (same convention every other cron in `vercel.json` uses — not a namespacing concern since it's a single internal secret, not per-program credential material).
- Abuse/failure alerting can reuse the existing `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` (`lib/telegram/send.ts`'s `sendToAdminChat`) — same channel every other cron failure already alerts to.
- Error monitoring reuses the existing `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.

**One open choice, not a blocker:** if the team wants onboarding-specific abuse alerts routed to a *different* Telegram/LINE chat than the shared admin chat (e.g., so HR sees onboarding-specific pings without noise from every other cron's failures), that would need a genuinely new, properly namespaced var — e.g. `RECRUIT_ONBOARDING_ALERT_CHAT_ID` — per this project's established `<PROGRAM>_<PURPOSE>` convention (confirmed in `.env.example`'s documented pattern for `CHAIROPS_LINE_GROUP_*` etc.). Flagging as a decision for whoever owns the HR-facing dashboard, not something DevOps needs to decide unilaterally.

### 4.4 PII-at-rest nuance worth naming explicitly

`CHAIROPS_DRIVE_CRYPTO_KEY` protects the org's **Drive OAuth refresh token**, not the uploaded ID-card photos/selfies/contracts themselves once they land in Drive — those are protected by Google Drive's own storage security, which is what the workshop's decision to use Drive (over building custom encrypted storage) already accepted as sufficient. Not a new gap introduced by this feature, just worth stating plainly so nobody assumes there's app-level encryption-at-rest on the documents themselves.

---

## Summary for the synthesis pass

- **Deploy:** clean isolated build (new tables + forked components), two shared touch-points need regression testing beyond the feature itself (core auth guard, shared Drive connection). `/verify` + its enforcing hook already gate prod pushes; the schema-must-be-applied-before-code-references-it sequencing (`check-schema-applied.mjs`) is the one sequencing detail specific to this feature's new tables. Recommend splitting "merge to setup" from "flip the public form live" into two separate CEO approvals, since legal review of contract wording is still pending.
- **Monitoring:** Sentry's existing PII scrubber is a lucky, direct fit. Everything else (volume, Drive-upload failures, capture failures, bot-abuse proxy via 429 counts) is a small additive build riding on infrastructure (HR dashboard, cron runner, Telegram alerts) already being built or already existing — no new service needed.
- **Kill switch:** no generic mechanism exists today; recommend a permanent DB-backed toggle (not env var) checked at all 4 public entry points, which the feature's own staged-tables + manual-approval design makes safe to flip without losing in-flight legitimate work. Flagging the shared rate-limiter's stated scaling ceiling and a Vercel-edge-protection option as complementary, not required-for-launch, defenses.
- **Env/secrets:** no new credentials needed — Drive reuses the existing 3-module-shared OAuth connection as-is. Flagging (not blocking on) the pre-existing namespacing debt in those shared vars, since this feature becomes a 4th dependent on them.
