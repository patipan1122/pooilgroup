# BIGFEATURE recruit-onboarding — Persona: QA

**Feature:** ระบบรับพนักงานใหม่ออนไลน์ — one permanent, never-expiring, fully public URL (zero login, zero per-person code): 41-question form + 6 document uploads to Google Drive + full contract read (scroll-gated consent) + drawn signature + live selfie → submit → HR manual review → approve → atomic `User` creation, born `pending_verification`. Standalone, no link to `RecruitApplication`.

**Scope note:** Legal/business scope is FINAL (locked spec) — this doc does not re-debate it. My job is test scenarios, edge cases, and how to verify this actually works. Where I found the locked spec has no answer yet for a real failure mode, I flag it as a gap for the roundtable to resolve, not as something I've decided myself.

**Codebase investigated (pooilgroup-web, read-only):**
- `app/apply/[slug]/apply-client.tsx` + `submit-action.ts` — the only existing public, no-login, multi-file-upload submission flow in this codebase; closest real precedent
- `components/recruit/public-form-renderer.tsx` — honeypot bot-check, file-field UI, draft autosave
- `components/docuflow/signer-interface.tsx` — drawn-signature UI (`react-signature-canvas`)
- `components/playland/face-capture.tsx` — live-camera capture with 3-mode fallback
- `lib/recruit/drive.ts`, `lib/chairops/storage/drive.ts` — Google Drive upload pattern actually used in prod
- `app/api/r2/sign/route.ts` — the project's other public-ish upload gate, and why it was deliberately closed to anonymous callers
- `lib/rate-limit/index.ts` — existing DB-backed rate limiter (no new dependency needed)
- `prisma/schema.prisma` — `User` model, `RegisterRequest` model (approve→create-User precedent)
- Sibling docs already written in this same roundtable today: `BIGFEATURE_recruit-onboarding_PERSONA_BA.md`, `BIGFEATURE_recruit-onboarding_PERSONA_UX.md` — cited where their grounding overlaps mine so this doc doesn't duplicate work, only extends it into test cases

---

## 0. Severity summary (read this first)

| # | Finding | Severity | Area |
|---|---|---|---|
| 1 | `User` has no unique (or even present) national-ID field — nothing at the DB layer can stop two `User` rows for the same real person reaching active status | 🔴 P0 | Duplicate detection |
| 2 | The only public upload endpoint in this codebase (`/api/r2/sign`) was **deliberately closed to anonymous callers** after a past incident — this feature requires re-opening an equivalent-risk public upload surface **forever**, with no TTL to cap blast radius | 🔴 P0 | Spam/bot + security |
| 3 | No server-side rate limiting, CAPTCHA, or bot-check exists on the closest analog public form today — the one bot-check that exists (honeypot) is client-side JS only and is skipped entirely by anything that POSTs directly | 🔴 P0 | Spam/bot flood |
| 4 | Signature minimum-ink validation does not exist — `isEmpty()` only blocks a literally-zero-stroke canvas, a single dot or 3px scribble passes today | 🟡 P1 | Signature |
| 5 | No image-content validation exists anywhere (blank/black selfie or ID photo passes every existing check) — but `sharp` is already a dependency, so a cheap variance check is buildable with zero new deps | 🟡 P1 | Selfie/ID photo |
| 6 | "Live selfie capture" wording vs. the `capture="user"` file-input fallback (which still forces a fresh camera shot, just not an in-page stream) is an **unresolved business decision**, already flagged independently by the UX persona — if resolved as "hard block, no fallback," real candidates on old Android phones or desktop walk-ins get permanently stuck with no recovery path | 🔴 P0 (pending decision) | Camera fallback |
| 7 | Partial-failure state (Drive succeeds/DB fails or vice versa, double-submit) has no confirmed idempotency/transaction guarantee yet — the one existing analog (`submit-action.ts`) is NOT wrapped in `$transaction` and this codebase has a known incident history with exactly this class of half-written state | 🔴 P0 | Partial failure |
| 8 | "HR approved the wrong submission" has no undo path in the one existing precedent (`RegisterRequest`) — inherited blind spot, higher stakes here because User creation is atomic-at-sign, not atomic-at-approve | 🟡 P1 | Correction path |
| 9 | Scroll-gated consent is genuinely new UI with zero prior art in this codebase — several well-known cross-browser scroll-measurement footguns need real-device testing, not code review | 🟡 P1 | Scroll gate |
| 10 | No submission-volume anomaly alerting exists for any public form in this codebase today — a permanent, un-TTL'd link makes "nobody notices a bot flood for days" more likely than for any existing time-boxed link | 🟢 P2 | Ops/monitoring |

---

## 1. Public URL spam / bot flood

**Grounded today:** the closest analog, `/apply/[slug]`, has exactly one bot defense: a client-side honeypot field (`components/recruit/public-form-renderer.tsx:68,247-248,284-286` — hidden input, if filled the client-side `onSubmit` handler just returns `false` before ever calling the server action). `app/apply/[slug]/submit-action.ts` — the server action that actually writes to the DB — has **zero rate limiting and zero server-side bot check of any kind**. Anything that POSTs to the underlying mechanism directly (curl, a script, a headless browser that doesn't bother filling the DOM the way a real browser paints it) skips the honeypot entirely, because the check only lives in client JS that a bot has no obligation to execute.

There IS a reusable, already-battle-tested fix sitting in the repo: `lib/rate-limit/index.ts` — `checkRateLimit({ bucket, max, windowSec })` + `getClientIp(req)`, DB-backed, no new dependency, no Upstash/Redis needed. This is the ladder-first answer for IP-based throttling.

**Why this feature is categorically riskier than `/apply/[slug]`:**
- The URL is one unchanging link forever. Once indexed/scraped/screenshotted, it's a standing target — not a per-posting slug that closes.
- Each submission carries 6 file uploads to the **org's own** Google Drive connection (`lib/recruit/drive.ts` — one shared OAuth token for the whole org). A flood doesn't just fill a Postgres table, it burns Drive API quota and storage against the same account real HR staff use for everything else Drive-related in Recruit. A sustained bot flood is a noisy-neighbor problem for real candidates and real HR, not just junk rows.
- Zero login/zero code means there's no natural per-submitter key to throttle on except IP, which a distributed/residential-proxy bot defeats — good enough to stop the common single-script case, not a full defense.

**Test matrix:**

| Test | Expected | How to verify |
|---|---|---|
| Hammer the submit endpoint 50×/min from one IP with garbage payloads | 429 after N requests | Check `rate_limit_attempts` rows for the IP bucket; confirm HTTP response code |
| POST directly (curl/Postman), bypass client JS, honeypot field intentionally left as a bot would leave it | Rejected or flagged server-side — NOT accepted just because the honeypot "wasn't filled" | Server-side check exists independent of the client-only honeypot |
| Slow-and-low bot: 1 request/10 min from rotating IPs | This evades IP rate limiting AND the honeypot by design — confirm the team explicitly accepts this residual risk rather than assuming rate-limiting alone solves bot spam | Sign-off conversation, not a pass/fail test |
| 20 simultaneous real-looking submissions land in the same second | No duplicate Drive folders created — `ensureFolder` (`lib/chairops/storage/drive.ts`) must be race-safe, not create-blindly. **This exact bug class has bitten this codebase before** (Drive folder duplication from a race condition, CEO-reported 2026-06-07) | Concurrency test: fire N parallel submissions, count resulting Drive folders/subfolders |
| Submit 200 garbage rows over an hour | HR's review queue must not become unusable — verify whether v1 ships any bulk-reject/bulk-dismiss, or only one-row-at-a-time review (per BA's grounding, v1 HR dashboard is "list + status + resend" only, no bulk action called out) | Manual queue walkthrough with 200 seeded junk rows |
| Reuse the blacklist-style auto-flag pattern already proven at `submit-action.ts:120-134` (`flaggedBlacklist`/`blacklistReason`) | Junk submissions (zero-byte files, <5-second total fill time, empty required text) get an auto-flag HR can filter on by default, instead of requiring a human to eyeball every row to tell spam from real | Confirm this pattern was actually ported, not just theoretically available |

---

## 2. Camera unsupported / denied / no webcam (selfie fallback)

**Grounded today:** `components/playland/face-capture.tsx` already solves this exact problem — 3-mode fallback (live `getUserMedia` webcam → `<input type="file" capture="user">` which opens the phone's native front camera app → plain file picker for desktop-no-webcam), gesture-gated permission request (explicit tap before requesting camera, not a `useEffect` auto-request — browsers can silently swallow permission prompts fired outside a user gesture, called out in the component's own comment at line 92-93), and 5-way error classification (`denied` / `no-camera` / `in-use` / `no-support` / `other`) each with an actionable Thai-language message.

**This is not a hypothetical gap — the UX persona in this same roundtable already flagged the exact open question** (`BIGFEATURE_recruit-onboarding_PERSONA_UX.md` §4, point 4): does "LIVE selfie capture" in the locked spec forbid the `capture="user"` fallback? That fallback still forces a fresh shot through the OS camera app (not a gallery pick), but it's technically routed through a file input, not an in-page video stream. If the answer ends up "fallback forbidden, hard-block instead," a real, non-trivial population of candidates — old Android phones common among blue-collar hires, desktop walk-ins at the office with no webcam — get **permanently stuck** at this one step, with **no recovery path**, because there's no reference code for HR to spot who got stuck and follow up. I'm flagging this as P0-pending-decision rather than assuming an answer either way.

**Test matrix (build once the fallback decision is made, run against real devices — device-emulation in desktop dev tools does not reliably reproduce `getUserMedia` permission behavior):**

| Device / condition | Expected |
|---|---|
| Desktop Chrome, camera present, permission allowed | Live preview → capture works |
| Desktop Chrome, no camera hardware | `NotFoundError` → classified `no-camera` → clear path to upload fallback, not a dead end |
| Camera permission denied at OS level (not just prompt dismissed) | `NotAllowedError` → instructions shown must actually match the real device's settings path — current copy is Chrome-desktop/macOS-specific; verify (or branch) copy for Android Chrome and iOS Safari, which have different settings paths |
| Camera in use by another app (video call open) | `NotReadableError` handled, not a silent freeze |
| Old Android browser with no `mediaDevices.getUserMedia` at all | `no-support` branch fires immediately, defaults straight to upload mode — must NOT show a "ขออนุญาตเปิดกล้อง" button that does nothing when tapped |
| iOS Safari, `capture="user"` fallback | Confirm on a real iPhone that this actually opens the **front** camera — historically inconsistent across iOS versions, some default to rear even with `user` |
| Corrupt/truncated image file picked via fallback | Component currently just calls `onChange(dataUrl)` after `FileReader`+`Image.onload` succeeds — if a partially-decoded image still "succeeds" at the browser level, a garbage/partial photo silently passes as "captured." Test with a deliberately truncated JPEG |

---

## 3. Signature minimum-ink validation

**Grounded today:** `components/docuflow/signer-interface.tsx:147` — `if (padRef.current.isEmpty()) { ...block... }` — this is the ENTIRE validation. `isEmpty()` (from `react-signature-canvas`) only returns true for a literally zero-stroke canvas. `getTrimmedCanvas()` (line 154) crops to the drawn bounding box but never checks whether that box is meaningfully sized. No minimum stroke-length, bounding-box-size, or point-count check exists anywhere in this codebase.

**Test matrix:**

| Test | Expected | Current state |
|---|---|---|
| Single tap, no drag | Confirm whether `react-signature-canvas` registers a 1-point tap as empty or non-empty — untested assumption either way | Needs explicit verification, this determines whether case below is even reachable |
| 3px scribble (one quick flick) | Should be rejected as "not a real signature" | Currently PASSES — `isEmpty()` is false, nothing else gates it |
| Recommended fix to test once built: reject if drawn bounding box < ~40px in both dimensions, or total point count below a floor | Blocks trivial scribbles without requiring a "pretty" signature | Not yet built — flag as required before ship, not optional polish, given this is a real employment contract |
| Server-side re-check of the signature image (not just client JS) | Client-side gates are bypassable by anyone POSTing directly (same class of gap as the bot-check issue in §1) — the server must independently validate the signature blob has real content | Nothing in `submit-action.ts` or any upload path validates image content today |

---

## 4. Blank/black image as selfie or ID document (content validation)

**Grounded today:** repo-wide search for liveness/face-match/blank-image checks came back empty across the whole codebase. Neither of the two closest upload UIs cited by the UX persona (`components/chairops/id-card-upload.tsx`, `components/cashhub/slip-camera.tsx`) validates image content — both only handle upload state (loading/uploaded/error), not what's actually in the picture. **Nothing anywhere in this codebase checks that an uploaded "photo" isn't a solid black or white rectangle.**

Good news worth noting concretely: `sharp` (v0.34.5) is already a project dependency (`package.json`). A cheap server-side pixel-variance check (`sharp().stats()`, reject if per-channel stddev is near zero) closes the "obviously blank image" case with **zero new dependencies** — this is not the same ask as full liveness/face-detection (explicitly out of scope per the sibling ChairOps workshop's "Won't" list, and not requested for this feature either). I'm not asking for fraud-proofing; I'm flagging that the current bar is literally zero, and a one-line variance check would meaningfully raise it for near-zero cost.

**Test matrix:**

| Test | Expected |
|---|---|
| Submit a solid-black or solid-white JPEG as the selfie | Should be rejected with an actionable message — confirm it currently is NOT (sails through every existing check: valid MIME, valid size, camera-flow "captured" state) |
| Submit an obviously mismatched image (e.g. a photo of a wall) as an ID document upload | Same as above — flag whether even a trivial variance check applies to the 6 document uploads, not just the selfie |
| Submit a real stock photo / someone else's face as the "selfie" | No variance check catches this — this residual risk should be explicitly accepted in sign-off, not silently assumed solved once a variance check ships |
| Confirm the variance check (once built) doesn't false-positive on a legitimately low-contrast real photo (e.g., dim indoor lighting, common for a phone selfie in a dorm room at night) | Needs a real threshold-tuning pass with real sample photos, not just synthetic black/white test images |

---

## 5. Partial failure mid-flow (Drive succeeds / DB fails, or vice versa)

**Grounded today, two separate risk sources:**

1. **No transaction wrapping in the closest precedent.** `app/apply/[slug]/submit-action.ts` runs its writes as sequential independent Prisma calls (applicant upsert → blacklist check → application create → audit log → referral attribution → email) — NOT inside `prisma.$transaction`. A failure between steps there leaves a low-stakes orphan (`RecruitApplicant` with no application). The same sequential-non-transactional shape would be much higher-stakes for onboarding: a half-written state here could mean a signed contract with no corresponding system record, or a `User` row with no valid signed contract behind it.

2. **No documented storage fallback for Drive failures on this feature.** `lib/recruit/drive.ts`'s `uploadApplicantFileToDrive` is explicitly designed as "best-effort... falls back to R2 so the applicant is never blocked" (file header comment). But this feature's locked spec routes uploads to Google Drive with no R2 fallback mentioned anywhere I found. If the org's Drive OAuth session is expired or revoked at the exact moment a real candidate submits, the existing "never blocked" philosophy in this codebase assumes a fallback that won't exist here. Two plausible-and-both-bad default outcomes: silently accept a submission with 0-of-6 documents actually saved, or hard-fail and throw away 15 minutes of filled-in answers + drawn signature + selfie.

**Test matrix — all of these must be run against the actual built flow, not reasoned about in the abstract:**

| Scenario | Must verify |
|---|---|
| Revoke org Drive OAuth token mid-test, then attempt final submit (all 41 answers + signature + selfie already captured client-side) | Candidate sees an actionable retry, not a silent success and not a forced full restart from the landing page |
| Kill Drive access after 3 of 6 documents already uploaded, before the 4th | Either full rollback with a clear "try again" message, or resumable without re-uploading docs 1-3 — NOT a state where docs 1-3 sit orphaned in Drive with the submission itself lost |
| Simulate DB write failure after all 6 Drive files uploaded successfully | Orphaned Drive files are either cleaned up by a reconciliation job or linked on retry — confirm retry does not create 6 duplicate files (idempotency) |
| Toggle airplane mode mid-submit on a real phone (matches how real candidates fail — spotty wifi, not a clean simulated timeout) | Clear "not submitted" state, no infinite spinner, no false "submitted!" screen |
| Double-tap the submit button (realistic on slow mobile networks) | Exactly one Drive folder, one signature file, one consent record, one `User` row — not two. Confirm an actual idempotency key/unique constraint exists, not just documented intent |
| Browser crash / tab close between "selfie captured" and "final submit" | Given no reference code exists at all, confirm the real recovery path: same-device localStorage resume only (per UX persona's session-id proposal), and specifically whether the 6 already-uploaded Drive file references are restored on resume or the candidate must re-upload everything |

---

## 6. HR approves the wrong submission — correction path

**Grounded today:** `RegisterRequest` (`prisma/schema.prisma` ~line 720, cited by BA persona) is the one existing precedent for "public-ish form → HR approve → create User": `status(pending|approved|rejected)/reviewedById/reviewedAt/rejectReason/resultUserId`. I did not find any evidence that flow has ever needed to solve "HR approved the wrong one" — if that's true, this feature inherits the same blind spot, at meaningfully higher stakes, because `RegisterRequest` approvals are presumably for access grants tied to an already-known internal person, while onboarding approvals mint a brand-new real employee identity out of a fully anonymous public submission.

Per the locked spec + this roundtable's Consensus Decision (§3.4 of the workshop doc, same conceptual resolution applies here): `User` creation is **atomic at the sign step**, born `pending_verification` — HR's "approve" action is a status flip on an already-existing row, not the moment of creation. That matters for the correction path: "HR approved the wrong row" doesn't mean preventing a creation, it means **reversing an already-created User's status**, which is a materially different (and currently unverified) capability.

**Test matrix:**

| Scenario | Must verify |
|---|---|
| HR clicks approve on the wrong row out of 2 similarly-named submissions | Is there an in-UI way to reverse the approval (flip the User back out of active status) without an engineer doing a manual DB fix? Treat "no" as a P0 finding, not acceptable for ship |
| Candidate typo'd their own legal name at submission (nothing cross-checks self-reported name against any authoritative source) and HR didn't catch it either | Confirm HR (or any admin) can still open and edit the resulting User's `name`/`phone` through the normal admin user-edit screen after creation — and specifically that `pending_verification` status doesn't block that screen from opening |
| Two submissions that are genuinely the same person (see §7) both reach HR's queue | Confirm HR's review screen surfaces a duplicate-warning proactively, before the approve click — not purely a manual-diff burden on a busy reviewer skimming a list |

---

## 7. Same phone/ID submitted twice — duplicate real-employee detection

**This is the single largest grounded gap found in this investigation, and it's P0.**

Grounded facts, checked directly against `prisma/schema.prisma`:
- `User.phone` — `String?`, **not unique**, nullable.
- `User.email` — `String? @unique` — unique but optional; many candidates in this hiring pool plausibly won't have one.
- `User.lineUserId` / `lineLoginSub` — unique, but only populated after a LINE login, which happens well after onboarding submission, not at intake.
- **There is no national-ID-number field on `User` at all**, unique or otherwise.
- `lib/recruit/types.ts:62` defines `format: "thai_id"` as a recognized hint in the generic form-schema type — but per the UX persona's grounded read of `public-form-renderer.tsx`, the renderer doesn't give it special treatment today (no digit-count or checksum validation; a `thai_id`-formatted field is validated as loosely as any short-text field). Thai national ID numbers carry a real, cheap mod-11 checksum — implementing that is a free, no-new-dependency way to catch a large share of fat-finger typos before they ever create ambiguity for HR.
- The one existing dedup precedent in this codebase — `app/apply/[slug]/submit-action.ts` (~lines 90-108) — dedupes by **normalized phone** via `findFirst` before `create`. It's a real, working pattern, but it operates on the OLD `RecruitApplicant`/`RecruitApplication` models, which this feature explicitly does not touch (standalone, per locked spec). Its existence in the codebase does not mean dedup exists for the new standalone onboarding entity — that has to be built fresh, and I found nothing confirming it has been.

Because the locked spec has zero identity gate at intake, the system has no signal that two form-fills are the same physical person other than whatever the candidate self-reports — and self-reported data can plausibly differ between two submissions from the SAME honest person (retyped phone number, different SIM) just as easily as it can MATCH between two DIFFERENT people (shared family/dorm phone).

**Test matrix:**

| Scenario | Must verify |
|---|---|
| Same person submits twice with identical phone + ID number (panicked, closed tab after selfie, started fresh instead of resuming) | HR sees these flagged as likely-duplicate before either gets approved — not discoverable only by a sharp-eyed manual review |
| Same person submits twice with a typo'd ID number the second time (digit transposed, one digit short) | Without checksum validation, this looks like two different people to any exact-match dedup. Test whether checksum validation exists server-side at input time (best: reject and ask for re-entry) vs. only catchable by an alert HR reviewer (worst case, and the likely current state) |
| Two different, unrelated candidates share a household/dorm phone number | Verify dedup logic weights ID number as the primary signal and phone only as a secondary weak one — phone-as-primary-key dedup would incorrectly flag two real, different people |
| Attempt to get two `User` rows to BOTH reach fully-active (non-`pending_verification`) status with the identical national ID number | A soft UI warning HR can click past under time pressure is not the same guarantee as a hard constraint — test for both: a warning AND a DB-level unique index backstop. Treat "warning only, no DB constraint" as insufficient for ship |

---

## 8. Scroll-gated contract-read consent — cross-browser/device reliability

**Grounded today:** independently confirmed via repo-wide grep (same result as the UX persona's own search) — zero prior art for "scroll to unlock" anywhere in this codebase. The recommended build approach (UX persona §3): track `scrollTop + clientHeight >= scrollHeight - threshold`, reusing the `ResizeObserver` technique already proven in `signer-interface.tsx:111-122`. Reasonable and low-dependency, but it inherits scroll-measurement footguns this codebase has never had to harden against before, because there's no precedent to have learned from. These need real-device testing — desktop dev-tools device emulation does not reliably reproduce them.

**Test matrix:**

| Condition | What to check |
|---|---|
| iOS Safari rubber-band/elastic overscroll | A fast flick that bounces past the end and springs back — confirm the unlock condition is satisfied by the overshoot (usually harmless) AND is not mid-bounce mismeasured in a way that reports a smaller `scrollTop` than true rest position, causing a false NOT-reached-end |
| Async web-font loading reflows text after initial layout | Throttle network, scroll to the apparent end before Thai fonts finish loading — confirm the gate doesn't falsely unlock against a stale, too-short `scrollHeight`, and doesn't get stuck falsely locked once fonts load and push the true end further down |
| Pinch-zoom mid-read on a real phone | Safari/Chrome mobile pinch-zoom operates on the visual viewport, not layout viewport — scroll to the apparent end while zoomed in, confirm unlock still fires correctly rather than silently never firing |
| Android Chrome pull-to-refresh interaction | Confirm the tracked scroll container is the inner contract-text box, not the page body — a page-level scroll listener can collide with pull-to-refresh gestures at the top |
| Threshold tuning | Confirm the "close enough to the end" threshold is generous enough that normal scroll-momentum deceleration (landing a few px short on a fast flick) doesn't strand an honest reader forever a few pixels short of unlocking |
| Desktop discrete mouse-wheel vs. trackpad momentum scroll | Both must reliably fire enough scroll events to detect the end |
| Re-entry (back out of the contract screen, return) | UX spec says the gate should reset and require re-reading — confirm this is a REAL reset (candidate must actually re-scroll) and not a cosmetic scroll-position reset while some other piece of state secretly remembers "already unlocked" |
| Keyboard-only / screen-reader navigation | A consent gate satisfiable only by a mouse/touch scroll gesture may be a real accessibility gap — worth a quick check even though not in the original ask, since it's a direct extension of "does the gate work for every real candidate" |

---

## 9. Pre-ship verify / smoke-test plan

This project has a `/verify` skill ("full pre-deploy verification — typecheck + lint + build + curl — never claim done without this"). This project's `build` script already chains two custom drift-guard scripts (`check-prisma-table-map.mjs`, `check-schema-applied.mjs`) before `next build` — good, this catches the exact "migration never applied" bug class that has taken down a whole module in this codebase before (RentSpace, unapplied migration, full outage). Any new Prisma models for this feature (staging table for onboarding submissions, whatever holds signature/consent records) must pass those two scripts as part of normal `npm run build`, which is itself a real automated test, not just a formality.

**Automated gate (must be green before manual click-through):**
1. `npm run lint`
2. Typecheck (project's TS gate)
3. `npm run build` — confirms schema-drift guards pass for any new tables this feature adds
4. `curl` the new public route(s) to confirm they resolve (200/expected shape), per this project's standard verify convention

**Manual click-through — on a real deployed preview URL, not localhost only** (this codebase has a documented pattern of guards that pass on a dev machine but not in the real deploy environment — always verify against the real thing):

1. **Happy path, start to finish, on an actual phone** (not desktop dev-tools emulation): all 41 answers, 6 uploads, full contract scroll, signature, selfie, submit. Confirm the success screen, and confirm the reused `/my/[refId]`-style status page (per UX's recommendation to extend the existing no-login status pattern rather than build a new one) shows the new submission.
2. **Verify in the real org Google Drive**: exactly 6 files landed, correctly organized/named, links open.
3. **Verify in the DB**: exactly 1 new row in the new standalone table — no duplicates from any client-side double-post during the test.
4. **HR side**: open the review queue, confirm the test submission appears, approve it, confirm a `User` row exists with `pending_verification` status, confirm that user **cannot log in yet**.
5. **Flip to active** (whatever mechanism HR approval triggers) and confirm login now works.

**Abuse-path smoke checklist (condensed from §1-§8 above, run once before calling this shippable):**
- [ ] Direct POST bypassing client JS, honeypot field filled as a bot would leave it — rejected server-side, not just client-side
- [ ] Camera permission denied on a real old Android phone — confirm a completable path exists, or confirm explicit sign-off that blocking is accepted
- [ ] Airplane-mode toggle mid-upload — no silent success screen, no duplicate Drive folder on retry
- [ ] Double-tap submit — exactly one resulting record, not two
- [ ] All 41 fields filled with garbage as fast as technically possible (sub-5-second total time, i.e. nobody actually read the contract) — confirm this is at minimum distinguishable from a real submission in HR's queue, not indistinguishable
- [ ] Two submissions with identical ID number — flagged before either is approved, not silently both approvable

**Operational gap worth naming even though it's not a pass/fail test:** no submission-volume anomaly alerting exists for any public form in this codebase today. For a link with a TTL, a bot flood naturally caps itself when the link rotates or expires. This link has none — a flood could run for days before a human notices. Recommend this gets a cheap volume-spike alert (e.g., daily count vs. rolling average) before or shortly after launch, not as a blocking condition for v1 ship, but flagged so it doesn't get forgotten (🟢 P2).

---

## 10. What I deliberately did not test (out of scope, for clarity)

- Real liveness/anti-spoofing on the selfie (someone holding up a photo of someone else) — explicitly out of scope per the sibling ChairOps workshop's "Won't" list, and not asked for here either. The variance-check recommendation in §4 catches "obviously blank," not "obviously fake."
- Legal validity/enforceability of the contract wording itself — Legal persona's territory, not QA's.
- Full accessibility audit beyond the one scroll-gate note in §8 — flagged as worth a follow-up pass, not solved here.

---

## Summary (for synthesis)

Three findings are P0 and load-bearing enough that I'd want them resolved before ship, not deferred to v1.1: **(1)** no DB-level way to stop the same real person becoming two `User` rows (no unique ID field exists on `User` at all today), **(2)** this feature reopens a public-upload attack surface that was deliberately closed once before in this exact codebase, this time permanently and with zero rate limiting proven in place yet, **(3)** partial-failure state (Drive vs. DB, double-submit) has no confirmed transaction/idempotency guarantee, and this codebase has direct incident history with exactly this failure class. The camera-fallback wording question (§2/§6 above) is also P0-severity in impact (candidates permanently stuck) but is genuinely a pending business decision, not an engineering gap — it just needs an explicit answer, flagged independently by both UX and QA in this same roundtable. Everything else (signature min-ink, image blank-check, HR undo, scroll-gate cross-browser hardening) is real but P1/P2 and buildable with existing in-repo primitives (`sharp`, `lib/rate-limit`, the `ResizeObserver` pattern already in `signer-interface.tsx`) — none of it requires a new dependency.
