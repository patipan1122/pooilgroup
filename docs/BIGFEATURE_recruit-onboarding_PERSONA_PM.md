# BIGFEATURE recruit-onboarding — Persona: PM

**Feature:** ระบบรับพนักงานใหม่ออนไลน์ — one permanent public URL, 41-question form + Google Drive ID docs + drawn-signature + live-selfie contract signing, HR-approval-gated `User` creation.
**Mode:** Spec + Build (write real code, verify typecheck/lint/build; no production deploy without separate explicit CEO sign-off).
**Scope note:** Legal/UX/architecture are locked by the CEO. This doc is PM-only: scope cut, effort, risks, rollback — grounded in the actual repo state, not the earlier workshop draft (see §0, important).

**Codebase investigated (pooilgroup-web, worktree `claude/recruit-onboarding-workshop-2026-09-20`):**
- `app/apply/[slug]/apply-client.tsx` (142 lines) — thin public-form shell
- `components/recruit/public-form-renderer.tsx` (831 lines) — field renderer, Drive→R2 fallback upload, honeypot, draft autosave
- `app/api/recruit/upload-drive/route.ts` (102 lines) + `lib/recruit/drive.ts` (140 lines) — Drive upload pattern
- `components/docuflow/signer-interface.tsx` (411 lines) + `components/docuflow/signer-risk-summary.tsx` (142 lines) — PDF+placement signer UI, AI risk summary (no per-clause gate)
- `app/sign/[placementId]/page.tsx` + `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts` — both hard-`requireSession()`, R2-backed
- `components/playland/face-capture.tsx` (257 lines) — existing live-camera capture widget
- `lib/rate-limit/index.ts` — DB-backed rate limiter (already used by `upload-drive`)
- `prisma/schema.prisma` (9,310 lines) — `User`, `RecruitApplication`, `Document`/`PersonDocument`/`DocumentSignaturePlacement`, `RecruitCompanyScope` enum (`POOIL|JPSYNC|BOTH`), `AuditLog` (immutable-log precedent)
- `vercel.json` — 30+ existing crons (Pro-tier confirmed by volume; one more is cheap)
- Also read `docs/BIGFEATURE_recruit-onboarding_PERSONA_UX.md` (already written by UX persona in this same run) to stay consistent — cross-referenced below where it changes my effort numbers.

---

## 0. 🔴 Flag before anything else: the checked-in workshop doc disagrees with the locked spec on 4 points

`docs/WORKSHOP_recruit-employee-onboarding.md` (revised 2026-09-21) is the only written spec artifact in the repo, and **every other persona in this roundtable is likely to open it**. But the LOCKED FEATURE SPEC this `/bigfeature` run was given supersedes it on at least 4 material points that a builder could easily get wrong by trusting the file instead of the brief:

| Point | WORKSHOP.md (2026-09-21, in-repo) | Locked spec (this run — authoritative) |
|---|---|---|
| Access gate | 6-digit **reference code** typed before the form (§0.1, §4.3) | **No code, no token at all** — genuinely one fixed public URL forever |
| "Signature" | **Typed name + accept button** (§0.2 — CEO explicitly said no drawn signature) | **Drawn signature** (canvas) **+ live selfie** |
| Link to pipeline | `RecruitApplication.resultUserId` FK, HR reconciles via applicant match (§4.3) | **Standalone** — explicitly no link to `RecruitApplication` |
| `User` creation timing | Atomic **at sign-time** (§3.4, §4.4) | Atomic **at HR-approval-time** (a separate, later manual review step) |

**Why this matters for effort, not just correctness:** these aren't cosmetic — they change which components get reused (typed-name needs zero canvas work; drawn signature + selfie is real net-new UI), which tables get built (reference-code invite table vs. none), and where the transaction boundary sits (sign-time vs. approval-time — different race conditions, see §5). The CEO already spent a full revision cycle (2026-09-20 → 2026-09-21) resolving contradictions inside the workshop; if this run ships against the stale file, that cycle repeats.

**PM recommendation:** before engineering starts, someone (PM or SA) appends a **second revision entry** to `docs/WORKSHOP_recruit-employee-onboarding.md` §0 pointing at this locked spec as final, or marks the file deprecated in favor of this `/bigfeature` run's docs. I did **not** edit that file myself — it's UX-workshop-owned, not mine to overwrite, and I don't have a citable record of exactly when/how the CEO made these 4 further decisions. Flagging, not fixing, is the correct PM move here.

---

## 1. Scope — what's actually in v1

**Answering the brief's direct question: is the HR review/approve UI in scope?**
**Yes, in scope but minimal** — a list + one approve action + one activate action. Not building it is not an option: the workshop's own end-user simulation already found this (§4.11 of WORKSHOP.md — "ทุกที่นั่งที่จำลอง HR ยืนยันตรงกันว่าไม่มี = เลิกใช้กลับไปกระดาษ = ROI ทั้งฟีเจอร์เป็นศูนย์"), and it's independently obvious from the locked spec itself: **`User` creation is gated on HR's manual approval**, so without a review screen there is no code path that ever creates the employee account at all — the candidate-facing half of this feature is unshippable without it.

### Must (v1)
- Public form: fixed URL, 41 questions across sections (personal/address/emergency/education/work history/bank), age-gate (<18 → block self-service, route to manual HR process — no age-gate UI currently exists in this codebase, confirmed via grep)
- ID document upload → Google Drive, reusing `upload-drive` pattern with a **new**, separate MIME/size allowlist constant (must not touch `ALLOWED_FILE_MIMES` in `lib/recruit/types.ts` — that constant is live on `/apply/[slug]` today)
- Contract read screen: full text rendered from a **versioned, content-hashed template** (verbatim from the CEO-provided PDF — 119-day probation wording is legally load-bearing, zero paraphrase tolerance), must-scroll-to-end gate
- Drawn signature (fork the signature-pad chrome out of `signer-interface.tsx`, not the whole PDF+placement engine — see §2 for why that distinction is a real effort driver)
- Live selfie (fork `components/playland/face-capture.tsx`, **with its upload-fallback mode disabled** — see risk #4)
- New immutable consent record: timestamp, IP, user-agent, signature image, selfie image, content-hash of the exact contract text shown
- New public, non-authenticated sign route (existing `/sign/[placementId]` + its POST endpoint are both hard-gated on `requireSession()` — confirmed by direct read of `app/sign/[placementId]/page.tsx:37` and `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts:57` — neither is reusable as-is)
- HR review list (status column) + Approve action (creates `User`, `pending_verification`) + separate Activate action (flips to usable login) — reuse `RECRUIT_ADMIN_ROLES` gate from `lib/recruit/role-guard.ts`
- Rate-limiting on all 3 touched public endpoints (form submit, doc upload, signature/selfie submit) — reuse `lib/rate-limit/index.ts` (already the pattern `upload-drive/route.ts:29-39` uses)
- Auth guard: block login while `User.status = pending_verification` — one shared/core touch, not Recruit-local
- Retention janitor cron: delete submissions/documents for people who signed but HR never confirmed as "started" within the CEO-set window (locked spec says up to 1 year for "not hired")

### Should (v1, if time allows)
- Draft-key collision fix for the shared-device scenario UX flagged (their §2: one permanent URL means no per-person `slug` to key `localStorage` by — candidate #2 on the same office tablet can load candidate #1's half-typed Thai ID/bank info). This is a real PII leak, not cosmetic, but it's fixable as a follow-up patch (client-generated session id) without touching schema — doesn't have to block v1 launch if HR is told "one device per candidate, refresh between."

### Won't (v1)
- Linking to `RecruitApplication` in any form (locked, explicitly standalone)
- Reference codes, tokens, expiring links of any kind
- Full HR analytics/reporting dashboard
- Non-compete clause content (deferred by workshop's legal seat regardless of which spec version — both agree)
- OTP verification

### Edge cases carried over from the workshop that still apply (all locked-spec-compatible)
Sign-succeeds-but-User-creation-fails half-state, template-changes-mid-flight (content-hash snapshot handles it), document MIME sniffing (don't trust extension), <18 routing, blurry/fake documents. Two edge cases from the workshop **no longer apply** and should be dropped from anyone's checklist: "reference code guessed/brute-forced" (no code exists) and "regenerate reference code" (nothing to regenerate).

---

## 2. Effort estimate — by sub-task, one engineer, dev-days

| Sub-task | Days | Grounding |
|---|---|---|
| Schema + migration (2 new models, `User` status field/enum, indexes) | 0.5–1 | Additive only; `RecruitCompanyScope` enum already covers the two-company requirement — no new company-scoping concept needed |
| Public form fork (41 Qs, sections, age-gate calc, re-keyed draft) | 1.5–2 | `apply-client.tsx` is a thin 142-line shell (cheap to fork); the real weight is in `public-form-renderer.tsx` (831 lines) which is reused, not rebuilt — mostly config (schema JSON) not new component code |
| Upload integration (Drive-only, new ID-doc MIME allowlist) | 0.5–1 | `upload-drive/route.ts` (102 lines) + `lib/recruit/drive.ts` pattern already production-proven; mostly a new constant + route param, not new plumbing. **Open call, not mine to decide:** the existing pattern falls back to R2 on Drive outage "so the applicant is never blocked" (`upload-drive/route.ts:9-11`) — locked spec says Drive-only, no R2. Keeping the fallback is safer for candidates but technically violates the "NOT R2" instruction; flagging for SA/CEO, not deciding unilaterally |
| Signature + selfie flow | 1.5–2 | **Effort driver, read carefully:** the *reusable* part of `signer-interface.tsx` is only the signature-pad chrome (`SignatureFullscreenPad`, ~150 of its 411 lines) — the PDF-with-admin-placed-boxes machinery (`react-pdf`, `SignaturePlacementBox`, `embedSignatures`) is irrelevant here because the onboarding contract is a rendered text template, not a pre-uploaded PDF with placement boxes. `FaceCapture` (257 lines) is a closer 1:1 reuse but needs its upload-fallback branch stripped/disabled to satisfy "live selfie, not a pre-uploaded file" |
| Contract rendering + Risk Summary Gate (scroll-gate, per-clause checkboxes, `canSign`) | 2–2.5 | **Highest-risk line item.** Confirmed by direct code read: `signer-risk-summary.tsx` is a read-only AI-summary `<details>` toggle with **zero** state/checkbox/gating logic, and the sign button in `signer-interface.tsx:274-283` has **no** disabled-until-condition today. This is net-new UI + state machine, not a wiring change on top of existing components, despite how it can sound in a spec summary |
| HR review screen (list + Approve + Activate) | 1–1.5 | Reuses `RECRUIT_ADMIN_ROLES` gate verbatim; list pattern mirrors existing Recruit admin screens |
| Rate-limiting (3 endpoints) | 0.5 | Already-solved pattern (`lib/rate-limit/index.ts`), just wiring — see risk #5 for why the threat model here is still worth a second look despite the pattern being "done" |
| Auth guard for `pending_verification` | 0.5 | Small diff, but touches the shared login path — budget extra regression-test time, not extra code time |
| Retention janitor cron | 0.5–1 | `app/api/cron/clawfleet-photo-retention/route.ts` (127 lines) is a close structural precedent to adapt |
| Contract content wiring (verbatim PDF → versioned template, per-clause ids) | 0.5–1 | Mostly content-transcription discipline, not code volume — but must be done by/verified against the source PDF directly, not retyped from a description |
| Real-device QA pass (camera + canvas signature on 3+ real phones) | 1–1.5 | Per `[[recruit-canvas-parity-2026-05-22]]` memory: 3-device test catches ~80% of mobile interaction bugs — camera permission + canvas touch events are exactly the class of bug that only shows up off-simulator |
| Integration glue + typecheck/lint/build verify + buffer | 0.5–1 | |
| **Total** | **11–15.5 d** | **≈ 2.5–3.5 weeks, one engineer** |

Should-have draft-key fix (§1) adds ~0.5 d if pulled into v1.

---

## 3. Critical path

```
Schema ──► Public form + upload ──► Contract render + Risk Gate ──► Signature+selfie ──► Sign route (no-session) ──► HR Approve (creates User) ──► Auth guard (pending_verification) ──► Activate
                                                                                    │
Rate-limiting on all 3 public endpoints ───────────────────────────────────────────┘ (must land before/with first public exposure, not after)
Retention cron ── independent, can ship end-of-wave without blocking anything above
```

**Single point of failure:** legal content sign-off. Engineering can build the schema/UI/state-machine entirely in parallel with the lawyer review (per workshop's own recommendation, §7.C — "b: engineer starts now, wording is just a string swap later"), but **cannot go live** until the verbatim contract text is confirmed, because the content-hash / immutability design means swapping wording after the first real signature requires a new template version, not a hotfix.

---

## 4. Risks (severity-sorted)

1. 🔴 **Spec-vs-workshop-doc drift** (§0) — anyone building from `docs/WORKSHOP_recruit-employee-onboarding.md` instead of the locked brief builds the wrong access model, wrong signature mechanism, and wrong transaction boundary. Mitigation: flag now (done, §0), get the workshop doc corrected/deprecated before other personas' outputs harden around it.
2. 🔴 **`canSign` gate is genuinely unbuilt, not a wiring tweak** — confirmed by direct read of both `signer-risk-summary.tsx` and `signer-interface.tsx:274-283`: no scroll-tracking, no per-clause checkbox state, no disabled-button condition exists anywhere in the codebase today. If this is underscoped as "reuse `SignerRiskSummary`," it ships decorative and the entire legal purpose of the flow (proving informed consent, not just consent) is defeated — this was the whole point of the workshop's Section 3 debate.
3. 🟡 **`FaceCapture`'s built-in upload-fallback contradicts "live selfie only"** (`components/playland/face-capture.tsx:183-256`, `mode === "upload"`) — reusing it unmodified silently lets a candidate upload any photo file, including someone else's. Must be forked with that branch removed for this use case, or explicitly approved as a known bypass (some old laptops genuinely have no webcam) — this is a CEO trade-off call, not an engineering default.
4. 🟡 **Tokenless + permanent + public means IP rate-limiting is the *only* defense**, and the existing limiter's own doc-comment (`lib/rate-limit/index.ts:9-10`) says it's sized for ~200 internal users, not open internet traffic. A 41-question form + document upload + signature endpoint sitting open on the internet with zero CAPTCHA/token is a materially different threat surface than anything else currently rate-limited in this codebase — worth a second look before calling rate-limiting "done" just because the helper function exists.
5. 🟡 **PII accumulates for candidates HR never approves** — since `User` creation (and therefore any lifecycle tracking tied to it) only happens *after* HR approval, every submission that HR ignores, declines, or duplicates sits as raw Thai ID + bank account + selfie + drawn signature with no natural expiry pressure until the retention cron runs. If that cron slips from Must to a later wave, this PII has no deletion path at all in v1.
6. 🟢 **Positive finding — real reuse lowers risk more than the spec summary suggests:** honeypot bot-field, Thai-ID format validator (`format: "thai_id"` already defined in `lib/recruit/types.ts`), phone validator, Drive best-effort-upload pattern, `RECRUIT_ADMIN_ROLES` gate, and the `RecruitCompanyScope` enum (`POOIL | JPSYNC | BOTH`) already exist and map directly onto this feature's requirements with no new concepts needed.

---

## 5. Rollback plan

This is a **new, additive surface** — the only two non-additive touches are the shared login/session guard and the Recruit admin nav link. That makes rollback naturally low-risk:

- **Feature flag** (e.g. `RECRUIT_ONBOARDING_ENABLED`, namespaced per this repo's `<PROGRAM>_<PURPOSE>` env convention): when off, the permanent public URL renders a static "ปิดปรับปรุงชั่วคราว — ติดต่อ HR" page instead of 404ing. This matters specifically *because* the URL is meant to be permanent and will already be handed out verbally/physically to new hires by the time any rollback is needed — a dead link looks broken even when the disable was intentional.
- **New tables are pure-additive**, zero inbound FK from any existing table (per the locked "standalone" decision — nothing references `RecruitApplication`, and nothing existing references the new onboarding tables either). Safe to `DROP TABLE` if ever fully abandoned.
- **The one non-additive change** — the `pending_verification` check in the core login/session path — must ship as a strictly-additive early-return that no-ops for every existing user (whose status is unaffected by this migration). Regression test: log in as an existing seeded user before and after deploy, confirm zero behavior change.
- **Already-signed submissions are never deleted or mutated on rollback** — the immutable-consent design means disabling the flag only stops *new* submissions; HR can still approve/activate anyone already in the pipeline via the (separately-gated) review screen, so an emergency disable doesn't strand mid-hire candidates.
- Hard rule (repo convention): no destructive migration, no `prisma db push --accept-data-loss`.

---

## 6. Recommendation

**GO**, with two pre-conditions before engineering starts, not after:
1. Resolve §0 (workshop-doc drift) so every persona/engineer on this build is working from the same 4 decisions.
2. Get the verbatim CEO contract PDF into a reviewed, per-clause-tagged text source *before* the content-hash template is built — retrofitting clause ids onto an already-hashed template means every prior signature's snapshot becomes unversioned relative to the new structure.

**Realistic budget: 2.5–3.5 weeks, one engineer**, with the Risk Summary Gate (item 5 in §2) as the line most likely to slip — it has no direct precedent anywhere in this codebase to fork from, unlike almost everything else in this feature.
