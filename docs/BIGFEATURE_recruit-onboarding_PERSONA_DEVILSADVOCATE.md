# Devil's Advocate · Recruit Onboarding /bigfeature Roundtable

**Persona:** DEVIL
**Date:** 2026-09-22
**Scope:** Not re-litigating the locked legal/business scope. Everything below is about whether *this specific implementation* — Drive as storage, drawn-signature+selfie instead of OTP, a zero-auth permanent URL, no pipeline link — will actually survive contact with the real codebase and real abuse. Verdict: **three of these five mechanics contradict decisions the CEO already made one day earlier, in writing, in this project's own workshop doc.** That's not a style nitpick — it means the "locked" spec I was handed and the CEO's last recorded decision disagree with each other, and someone needs to find out why before code ships.

---

## Severity-ranked findings

### 🔴 P0-1 — Reusing `upload-drive` as-is will make Thai ID cards and bank books "anyone with the link can view," forever, with zero auth

`lib/recruit/drive.ts:69-85` (`makePublic()`), called unconditionally from `uploadApplicantFileToDrive()` at `lib/recruit/drive.ts:123`:

```
// Recruit files ARE meant to be viewable via link (CEO wants a public link to
// open resumes), so — unlike ChairOps' sensitive slips — we always grant
// anyone-with-link reader here.
async function makePublic(accessToken: string, fileId: string): Promise<void> {
  ...
  body: JSON.stringify({ role: "reader", type: "anyone" }),
```

This function was written for **résumés** — content the CEO explicitly wanted to be link-shareable. There is no gate, no env flag, no sensitivity check. `uploadApplicantFileToDrive` calls it on every file, unconditionally.

The locked spec says to route ID card photos, bank book photos, and the live selfie through "the module's existing `upload-drive` route." If that's taken literally, every one of those files gets a permanent, unauthenticated, never-expiring "anyone with this URL can view" Google Drive link — worse than the R2 presigned-URL pattern the rest of the app uses, because presigned URLs expire and this doesn't. One forwarded email, one pasted Slack link, one leaked HR spreadsheet, one browser-sync leak, and a Thai national ID + bank account photo is exposed permanently with no way to know it happened.

**The damning part: this codebase already learned this exact lesson, in a sibling module, 3.5 months ago.** `lib/chairops/storage/drive.ts:270-293`:

```
// SECURITY (2026-06-03): files (maid contracts, bank slips) are SENSITIVE, so
// "anyone-with-link reader" is OFF by default. Files stay private to the
// connected Google account; ...
function publicLinksEnabled(): boolean {
  return process.env.CHAIROPS_DRIVE_PUBLIC_LINKS === "1";
}
async function makeAnyoneReader(accessToken: string, fileId: string): Promise<void> {
  if (!publicLinksEnabled()) return;
  ...
```

ChairOps treats "bank slips" as sensitive-by-default and gates public links behind an explicit opt-in env var. Recruit's `drive.ts` has the identical function with the identical Drive API call, minted for a different sensitivity class (résumés), and nobody has forked it for ID documents. "Reuse the existing route" as literally written reuses the wrong half of a decision this same team already made correctly once.

**Also:** access ultimately depends on whoever's personal/company Google account is behind `getDriveSession(orgId)` (`ChairopsDriveConnection`/equivalent recruit connection) — if that person leaves the company or the account is compromised, every ID card and bank book ever uploaded through this path goes with it. That risk exists independent of the public-link issue above.

**Fix is cheap and already exists in the codebase:** add the same `publicLinksEnabled()`-style gate (default OFF) to `lib/recruit/drive.ts`, or better, never call `makePublic()` for the new onboarding upload path at all — resolve access through the app's own auth-gated document viewer instead of a raw Drive link. This is a ~10-line change, not a redesign.

---

### 🔴 P0-2 — The locked spec's "drawn signature" appears to silently reverse a CEO decision made one day earlier, in this exact workshop

`docs/WORKSHOP_recruit-employee-onboarding.md`, Section 0, item 2 (2026-09-21 revision, i.e. **one day before** this feature is being built):

> **เซ็นออนไลน์ — ใช้แบบเบาที่สุด** — CEO เคยเสนอตัดลายเซ็นออกทั้งหมด... CEO เลือก **พิมพ์ชื่อ-นามสกุล + กดปุ่มยอมรับ (ไม่ต้องวาดลายเซ็น ไม่ต้อง OTP)**

Translation: the CEO explicitly rejected drawn signature ("ไม่ต้องวาดลายเซ็น" = "no need to draw a signature") in favor of typed-name + accept-button, specifically because it was judged the lightest legally-adequate mechanism after a 12-seat legal debate (Section 3.1-3.2 — the whole point of that debate was rejecting a heavier dark-pattern UI, and the team converged on typed-name as *lighter than* drawn signature, not equivalent to it). The Integration Map (Section 5, row `components/docuflow/signer-interface.tsx`) even says the component needs to be **forked** to accept a different `onSubmit`, precisely so the drawn-canvas behavior isn't inherited as-is.

I confirmed `components/docuflow/signer-interface.tsx` does in fact implement a drawn canvas today (`react-signature-canvas`, `getTrimmedCanvas().toDataURL("image/png")` — lines ~41, 154-155). So "drawn signature" in the locked spec is not a paraphrase of "typed name" — it's literally the mechanism the CEO's own workshop rejected 24 hours prior, and it matches what you get if `SignerInterface` gets reused *without* the fork the workshop called for.

I'm not asking to re-litigate which is "better" — the task brief says that's settled. I'm flagging that **the settled decision I can find on paper is typed-name, not drawn-signature**, and the two specs disagree. Someone should confirm the CEO actually re-opened and re-decided this between 09-21 and now, rather than the "locked spec" being a summary that drifted from the actual last decision.

---

### 🔴 P0-3 — "No token/reference-code, zero-auth" removes the one control the same workshop said was load-bearing *because* the URL is permanent

Workshop Consensus Decision #8 and Risk #3 (both from the same 2026-09-21 revision) are explicit that a permanent, non-expiring public URL is *more* dangerous than the originally-proposed expiring token, not less — and that the 6-digit reference code + rate-limiting was designed as the compensating control:

> **URL ถาวรใหม่ต้องมี rate-limit/anti-brute-force บนช่อง "รหัสอ้างอิง" อย่างเข้มงวด** — เพราะ URL เองเป็นสาธารณะและถาวร ไม่หมดอายุ ไม่มี `requireSession()` คุ้มกันเหมือนจุดอื่นในระบบ **ตัวรหัส 6 หลักคือด่านป้องกันเดียว**

("the 6-digit code is the single line of defense" — their words, not mine, written specifically to justify why a permanent public URL is safe to ship.)

The locked spec I was handed removes the reference code entirely ("NO token/reference-code") *and* — per item 3 of my brief — currently has no rate-limiting anywhere in the new form-submission flow. That's not "simplified," it's the exact scenario the workshop's own risk register warned against: a public, permanent, unauthenticated URL with no gate at all. Anyone who finds the link (search-engine crawl of an HR onboarding email, a screenshot posted in a Thai jobs Facebook group complaining about the process, an ex-employee sharing it) can submit unlimited fabricated full-PII+signed-contract packages, indistinguishable in the review queue from real ones (see P1-2 below).

If the CEO genuinely wants zero-friction (no code to type), that's a legitimate simplification — but it should be a **conscious trade** made knowing the workshop's own mitigation for exactly this URL shape gets deleted with it, not something that happens silently because "zero-auth" sounds simpler to describe.

---

### 🟡 P1-1 — "Live selfie" proves a face was photographed, not that it's the *right* face; there is zero cross-check infrastructure anywhere in this codebase

I grepped the entire app for face-match/liveness/selfie-verification code (`app`, `lib`, `components`): nothing exists. No facial comparison service, no liveness SDK, no third-party KYC integration. `lib/modules.ts:771` even lists "face recognition" as a *feature description string* for a different module (Playland turnstile access), not an implemented capability here.

So concretely: a candidate could upload someone else's stolen/borrowed ID card photo and bank book, take a selfie of their own face, and nothing in the system — automated or otherwise — flags the mismatch. The only backstop is an HR reviewer manually eyeballing two photos side-by-side in a Drive folder and noticing they're different people, which:
- doesn't scale past a handful of hires/week,
- is exactly the kind of control that silently degrades under load (the reviewer who's busy, or new, or reviewing 40 backlogged submissions after a flood — see P1-2 — will miss it),
- and produces zero audit trail if they get it wrong.

If OTP-to-phone was rejected specifically in favor of selfie+signature as *stronger* identity proof, that premise doesn't hold — OTP proves control of a phone number (weak but automatable and consistent), a bare selfie proves even less (a live human, not *which* human) unless it's paired with an automated face-match against the ID photo. Worth surfacing to CEO explicitly: is "HR eyeballs it" the accepted control here, or was automated cross-check assumed and never scoped?

---

### 🟡 P1-2 — Zero rate-limiting + no reference code = the most damaging failure mode is a drowned real submission, not storage cost

Storage/quota exhaustion is a red herring here — Drive gives the org 2TB free, uploads are capped at 4MB/file by the existing route (`app/api/recruit/upload-drive/route.ts:22,64-67`), and even the *existing* file-upload sub-step already rate-limits at 20 requests / 15 min / IP (`app/api/recruit/upload-drive/route.ts:29-33`, using the generic DB-backed `checkRateLimit()` from `lib/rate-limit/index.ts` — which is trivially reusable, ~3 lines, no new dependency, "already have it" per the Ladder in RULE I). So the *file* endpoint is at least partially covered by an accident of reuse.

The endpoint that isn't covered — because it doesn't exist yet — is the actual form-submission/account-creation endpoint that will accept the 41-field PII payload. Given the URL is permanent, public, and (per the locked spec) has no reference code to gate entry, the realistic damaging scenario isn't disk space — it's **queue flooding**: a burst of automated or just-curious-human submissions (bots probing for open forms, a troll who finds the link, even well-meaning duplicate submissions from a confused real candidate hitting "submit" multiple times because there's no confirmation state tied to a code) buries the one real new-hire's submission in a sea of visually-identical raw rows, with nothing in the data model to say "this one was actually offered a job" (see P1-3). HR dashboard "list + status" (workshop Decision #11) helps triage status, but not authenticity.

Fix is cheap and precedented: apply the same `checkRateLimit()` pattern to the new submission endpoint (per-IP and/or per-reference-code-attempt), which the codebase already proves out at `app/api/recruit/upload-drive/route.ts:29-38`.

---

### 🟡 P1-3 — With no pipeline link and no reference code, HR has literally nothing to check a submission against except memory

`RecruitApplication` already has a human-readable reference (`refId String @unique`, e.g. `"APP-2026-001234"` — `prisma/schema.prisma:1396`) sitting unused for this purpose. The original workshop's design (`RecruitOnboardingInvite.referenceCode` + `RecruitApplication.resultUserId` FK, Consensus Decisions #3 and #7) exists specifically so a submission in the review queue is *provably* tied to a real HIRED applicant, not just self-reported.

Strip that out (per the locked spec) and HR's review queue becomes a list of raw, self-asserted rows — name, salary, branch, bank details — with no system-level signal distinguishing "we actually offered this person a job" from "someone typed a plausible-looking submission." At today's volume ("HR remembers who they hired") this is probably fine. It stops being fine at the first busy hiring month, the first HR staff turnover, or the first deliberate attempt to plant a fraudulent submission (an ex-employee who knows the branch/salary bands, e.g.) — and there's no cheap way to retrofit "which of these old submissions were real" after the fact, because nothing was ever linked.

This doesn't need to be solved with the full workshop machinery (TTL tokens, per-person links). A **much cheaper partial fix that doesn't reopen the "must be zero-auth" decision**: let HR optionally attach a `RecruitApplication.refId` when reviewing a submission (free-text match, not a required gate at entry) so at least the audit trail *afterward* shows which pipeline record (if any) a hire ties back to. That's a read-time convenience, not a write-time barrier — it doesn't compromise the "no friction at signup" goal, it just stops the review queue from being permanently unlinkable to the hiring record 41 fields ago.

---

### 🟡 P2 — "Reuse the existing `upload-drive` route" is not literally possible without a code change, because the route currently requires a job posting

`app/api/recruit/upload-drive/route.ts:69-75`:

```ts
const posting = await prisma.recruitJobPosting.findUnique({
  where: { slug },
  select: { id: true, status: true, orgId: true, title: true },
});
if (!posting || posting.status !== "OPEN") {
  return NextResponse.json({ error: "ประกาศปิดรับแล้ว" }, { status: 400 });
}
```

The route's *only* way to resolve which org's Google Drive to upload into is via `RecruitJobPosting.slug → orgId`, and it hard-rejects unless that posting's status is `OPEN`. This app is genuinely multi-tenant (`Organization` model, many orgs — confirmed in `prisma/schema.prisma:19` and used throughout `lib/recruit/*`), so org-resolution here isn't optional plumbing, it's the RLS/tenancy boundary.

A standalone onboarding URL that's deliberately *not* linked to any posting (per the locked spec) has no `slug` to pass. Literally "reusing" this route is therefore impossible as-is — it needs either a new org-resolution path (e.g. resolve org from the reference-code/invite record instead of a posting) or a parallel route that duplicates the Drive-upload logic. Either way, the "reuse, don't build new" cost assumption baked into treating this as a copy-paste is wrong; budget real design time for how org context flows into the new endpoint, not just how files flow into Drive.

---

## Workshop items that may have been dropped rather than deliberately overridden (task item 5)

Checked `docs/WORKSHOP_recruit-employee-onboarding.md` against the locked spec I was given. None of these are mentioned one way or the other in the locked spec — which doesn't mean they were cut, but means nobody should assume they survived by default:

| Workshop item | Where | Status in locked spec |
|---|---|---|
| Age-gate, auto-block <18 from self-service (Decision #9) | Section 4 item 9 | Not mentioned. 41-field form presumably has DOB; worth confirming the gate is still wired, since it has real legal teeth (labor-inspector notification, guardian consent) that a generic "HR reviews later" step won't satisfy after the fact. |
| Separate PDPA consent specifically for the ID photo as sensitive data, distinct from general contract consent (Decision #10) | Section 4 item 10 — Legal's own novel finding, not boilerplate | Not mentioned. "HR manually reviews/approves" doesn't describe a consent capture step at all. |
| Content-hash snapshot of the contract text at signing time (Decision #6) | Section 4 item 6 | Not mentioned. Matters more, not less, now that "drawn signature" is back in play (P0-2) — if the signature mechanism reverted, the audit-trail-content-hash pairing it was designed to sit alongside should be checked too. |
| Rate-limit specifically framed as "the single line of defense" for the permanent URL (Decision #8 / Risk #3) | Section 4 item 8, Section 8 risk 3 | Confirmed dropped (P0-3 above) — most severe of this group since it was flagged 🟡 *already* by the workshop before the reference-code was also removed. |
| Onboarding janitor cron for stale/abandoned submissions + retention purge (Decision #13) | Section 4 item 13 | Not mentioned. Less urgent day-1, but without it, abandoned self-service attempts (age-gated minors, people who started and vanished) accumulate PII with no deletion path — the exact failure mode Legal flagged for the sensitive ID photo specifically. |

None of these require re-litigating the settled legal wording — they're implementation-plumbing items the CEO's own domain-expert panel already worked out the shape of. The cheapest fix here isn't "redo the workshop," it's a two-line CEO confirmation: "still in v1" vs "consciously cut," per item, before code starts.

---

## What I'd actually block on before writing code

1. Get an explicit yes/no on whether "drawn signature" (P0-2) and "no reference code" (P0-3) are real, reconsidered decisions or spec drift from the 09-21 workshop outcome — both are one-line CEO answers, not engineering work.
2. Do not let `uploadApplicantFileToDrive()`'s `makePublic()` touch ID card/bank book/selfie files unmodified (P0-1) — this one I'd treat as non-negotiable regardless of how the other two shake out, because it's a straight security regression against a pattern this same codebase already fixed once.
3. Everything else here (rate-limit on the new endpoint, HR-side optional refId cross-link, org-resolution redesign for the upload route) is normal build-time scope, not a blocker — just don't let "reuse existing route" hide the fact that two of the three pieces being reused (Drive public-link default, posting-based org resolution) don't actually fit this use case unmodified.
