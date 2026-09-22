# SA (System Analyst) — Recruit Online Onboarding — DB/API Design

Repo read: `~/Code/pooilgroup/legacy/pooilgroup-web` (prisma/schema.prisma is 9310 lines — read in targeted slices, not in full).

All new tables use `@@schema("public")` — same schema as the rest of the Recruit module (`RecruitJobPosting`, `RecruitApplication`, etc. all live in `public`, NOT a dedicated `recruit` Postgres schema the way ChairOps/Playland get their own schema). Following that convention, not inventing a new schema.

---

## 1. Prisma models

### Why 3 tables, and why this typed/JSON split

`RecruitApplication` (the existing applicant-tracking model, line ~1391 of schema.prisma) stores answers as a JSON blob (`answers Json @default("{}")`) because its form schema is **admin-configurable** (`RecruitJobPosting.fieldSchema` — HR can add/remove fields per posting). Our onboarding form is the opposite: a **fixed** 41-question form, CEO-locked, not admin-editable. That changes the right default — I can afford typed columns for anything HR/the system will ever query, sort, filter, or validate at the DB layer, and push only the genuinely descriptive/free-form remainder into a JSON blob.

Fields promoted to typed columns (and why):
- `companyId`, `branchId`, `positionApplied`, `desiredStartDate`, `desiredSalary` — HR's review list is sorted/filtered by these ("show me everyone applying to สาขา X").
- `fullNameTh`, `nationalId`, `birthDate`, `phone`, `email` — identity fields. `nationalId` + `phone` are the natural **soft-dedup keys** HR needs ("has this person already submitted before?" — per spec there is deliberately **no hard unique constraint**, since the spec says HR reconciles duplicates/multiple postings *manually*; a hard `@unique` on `nationalId` would let a legitimate resubmission (rejected once, reapplying months later) 500 at the DB layer instead of surfacing as a "possible duplicate" banner in the review UI). `birthDate` is typed because the 18+ check needs to be both a client-side gate *and* a server-side re-validation at submit time (never trust client-only validation for a legal/compliance gate) — a JSON-buried date can't be indexed or re-validated cheaply.
- `bankName`, `bankAccountNo`, `bankAccountName` — payroll-adjacent; likely to be read by whatever HR does after hire (even though this spec doesn't wire it anywhere yet, typed columns cost nothing and save a future migration).

Everything else (full address, 2× emergency contacts, education history, work history, and any of the 41 questions not listed above) goes into `answersJson`, versioned via `schemaVersion` — **directly mirroring `RecruitApplication.schemaVersion`'s existing convention** so a future edit to the fixed form doesn't corrupt old submissions' shape.

```prisma
enum RecruitOnboardingStatus {
  SUBMITTED   // new hire finished the form + signed + uploaded docs
  APPROVED    // HR reviewed on-screen, User row created (isActive:false)
  REJECTED

  @@schema("public")
}

enum RecruitOnboardingDocType {
  ID_CARD
  HOUSE_REGISTRATION
  BANK_BOOK
  PHOTO               // front-facing photo (document, not the live selfie)
  EDUCATION_CERT
  OTHER
  SIGNATURE           // drawn-signature PNG (stored as a doc row, not a separate blob column)
  SELFIE              // live-camera capture JPEG

  @@schema("public")
}

// The onboarding submission itself — 1 row per new-hire attempt.
// Deliberately has ZERO foreign keys into RecruitApplication / RecruitApplicant /
// RecruitJobPosting (locked spec: fully standalone, HR reconciles manually).
model RecruitOnboardingSubmission {
  id                String                   @id @default(uuid()) @db.Uuid
  orgId             String                   @map("org_id") @db.Uuid

  // ── Section 1: position applied for (self-reported, HR verifies later) ──
  companyId         String                   @map("company_id") @db.Uuid   // real FK, not RecruitCompanyScope enum — see note below
  branchId          String?                  @map("branch_id") @db.Uuid   // nullable: "ยังไม่แน่ใจ / สมัครทั่วไป" self-report
  positionApplied   String                   @map("position_applied")     // free text — no position/job-title catalog table exists anywhere in the repo (RecruitJobPosting.title is free text too)
  desiredStartDate  DateTime                 @map("desired_start_date") @db.Date
  desiredSalary     Int?                     @map("desired_salary")       // self-reported, optional ("negotiable")

  // ── Section 2: personal info (subset that needs DB-level query/validation) ──
  fullNameTh        String                   @map("full_name_th")
  fullNameEn        String?                  @map("full_name_en")
  nationalId        String                   @map("national_id")          // 13 digits — soft dedup key, NOT unique (see rationale above)
  birthDate         DateTime                 @map("birth_date") @db.Date  // server-revalidates 18+ at submit time
  phone             String
  email             String?

  // ── Section: bank account ──
  bankName          String                   @map("bank_name")
  bankAccountNo     String                   @map("bank_account_no")
  bankAccountName   String                   @map("bank_account_name")

  // ── Everything else: address, 2 emergency contacts, education, work history,
  //    and any remaining Q of the 41 not promoted above ──
  answersJson       Json                     @default("{}") @map("answers_json")
  schemaVersion     Int                      @default(1) @map("schema_version") // mirrors RecruitApplication.schemaVersion

  status            RecruitOnboardingStatus  @default(SUBMITTED)
  reviewedById      String?                  @map("reviewed_by_id") @db.Uuid
  reviewedAt        DateTime?                @map("reviewed_at") @db.Timestamptz(6)
  rejectReason      String?                  @map("reject_reason")
  resultUserId      String?                  @unique @map("result_user_id") @db.Uuid // set once HR approves (mirrors RegisterRequest.resultUserId)

  ipAddress         String?                  @map("ip_address") @db.Inet   // captured at submit time (mirrors RegisterRequest.ipAddress)
  submittedAt       DateTime?                @map("submitted_at") @db.Timestamptz(6)
  createdAt         DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime                 @updatedAt @map("updated_at") @db.Timestamptz(6)

  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  company   Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  branch    Branch?      @relation(fields: [branchId], references: [id], onDelete: SetNull)
  reviewer  User?        @relation("RecruitOnboardingReviewer", fields: [reviewedById], references: [id], onDelete: SetNull)
  documents RecruitOnboardingDocument[]
  consent   RecruitOnboardingConsent?

  @@index([orgId, status, createdAt])
  @@index([orgId, nationalId])   // dedup lookup, not unique
  @@index([orgId, phone])
  @@map("recruit_onboarding_submissions")
  @@schema("public")
}
```

**Why `companyId` FK instead of the existing `RecruitCompanyScope` enum** (`POOIL | JPSYNC | BOTH`, used on `RecruitJobPosting`): that enum's `BOTH` value expresses "this posting is open to either company" — a scope over *postings*. A single new hire is joining exactly **one** company; `BOTH` is meaningless on a submission row. The real `Company` table (line 122, fields: `code`, `name`, `taxId`, etc.) already holds both "พีโอออยล์ จำกัด" and "เจพีซิงค์ กรุ๊ป จำกัด" as rows — a plain FK is the correct, already-established shape (`Branch.companyId`, `RecruitJobPosting.companyId` both do this).

```prisma
// Google Drive document references — one row per uploaded file
// (id card, house reg, bank book, photo, edu cert, other, + signature + selfie).
model RecruitOnboardingDocument {
  id             String                    @id @default(uuid()) @db.Uuid
  orgId          String                    @map("org_id") @db.Uuid
  submissionId   String                    @map("submission_id") @db.Uuid
  docType        RecruitOnboardingDocType  @map("doc_type")
  driveFileId    String                    @map("drive_file_id")
  driveUrl       String                    @map("drive_url")        // webViewLink
  driveDirectUrl String?                   @map("drive_direct_url") // uc?export=view inline
  fileName       String?                   @map("file_name")
  mimeType       String?                   @map("mime_type")
  sizeBytes      Int?                      @map("size_bytes")
  createdAt      DateTime                  @default(now()) @map("created_at") @db.Timestamptz(6)

  org        Organization                 @relation(fields: [orgId], references: [id], onDelete: Cascade)
  submission RecruitOnboardingSubmission  @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@index([orgId, submissionId])
  @@index([submissionId, docType])
  @@map("recruit_onboarding_documents")
  @@schema("public")
}
```

This mirrors `ChairopsDriveAsset` (line 4042 — `driveFileId`/`driveUrl`/`driveDirectUrl`/`fileName`/`sizeBytes` field-for-field), which is the closest existing "Drive file reference" shape in the repo, rather than inventing a new one. Difference: `ChairopsDriveAsset` is generic/polymorphic (`sourceTable`/`sourceId` strings, because it's shared across ChairOps categories) and lives in the `chairops` schema; ours has a real typed FK to one parent (`submissionId`) since it only ever belongs to one thing, and lives in `public` alongside the rest of Recruit.

```prisma
// Immutable consent/audit record — ONE per submission (1:1).
// "Immutable" = application code never issues an UPDATE against this row after
// creation (enforced by convention, same as ChairopsMaidContract.contentHash —
// there is no DB trigger enforcing it). Deletion IS permitted, for the 1-year
// retention purge (not-hired) or a PDPA erasure request — those are a different
// concern from in-life mutation.
model RecruitOnboardingConsent {
  id                    String    @id @default(uuid()) @db.Uuid
  orgId                 String    @map("org_id") @db.Uuid
  submissionId          String    @unique @map("submission_id") @db.Uuid

  signedAt              DateTime  @map("signed_at") @db.Timestamptz(6)
  signedIp              String?   @map("signed_ip") @db.Inet
  signedUserAgent       String?   @map("signed_user_agent") @db.Text

  // Pointers into RecruitOnboardingDocument (docType SIGNATURE / SELFIE).
  // Deliberately PLAIN uuid columns, no @relation — see rationale below.
  signatureDocumentId   String    @map("signature_document_id") @db.Uuid
  selfieDocumentId      String    @map("selfie_document_id") @db.Uuid

  contractContentHash   String    @map("contract_content_hash") // SHA-256 hex of the EXACT contract text shown at signing time
  scrolledToEnd         Boolean   @default(false) @map("scrolled_to_end") // server-set only when client reports the scroll-gate unlocked

  createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  org        Organization                 @relation(fields: [orgId], references: [id], onDelete: Cascade)
  submission RecruitOnboardingSubmission  @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@map("recruit_onboarding_consents")
  @@schema("public")
}
```

**Content-hash pattern — does it already exist? Yes, but NOT in DocuFlow.** I checked both places the task suggested: `DocumentSignaturePlacement` (DocuFlow's model, line 1204) stores only `signedAt` + `signedImageKey` — no IP, no user-agent, no hash, nothing. Its sign API (`app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts`) confirms this — it writes exactly those two fields and nothing else. The real precedent is **`ChairopsMaidContract`** (line 3260, `chairops` schema): `signatureImageUrl`, `signedName`, `signedAt`, `signedIp`, `signedUserAgent`, `contentHash` — with an explicit code comment: `// Legal hardening (F4b · CEO 2026-08-02) — พ.ร.บ. ธุรกรรมทางอิเล็กทรอนิกส์ ม.9.` That's the one I copied the shape from. One inconsistency worth flagging: `ChairopsMaidContract.signedIp` is plain `String?`, while `RegisterRequest.ipAddress` and `AuditLog`'s ip column use `@db.Inet`. I went with `@db.Inet` (the more common, more correct Postgres type across the base schema) for the new table — recommend the same if anyone later back-fills a type on `ChairopsMaidContract`.

**Why `signatureDocumentId`/`selfieDocumentId` are plain UUID columns, not `@relation` FKs to `RecruitOnboardingDocument`:** if they were real FKs, purging a submission after 1 year would need Postgres to cascade-delete in two independent directions off the same parent (`document.submissionId → CASCADE` and `consent.submissionId → CASCADE`) *plus* a third FK (`consent.signatureDocumentId → document.id`) that would need its own `ON DELETE` action to avoid a `RESTRICT` collision mid-cascade. That's a real footgun for zero benefit — the authoritative link is already `submissionId` on both tables; `docType` is enough to look the row up (`documents.find(d => d.docType === "SIGNATURE")`). Kept plain UUIDs + an index instead.

---

## 2. Atomic `User` creation

**Read `model User` (schema.prisma line 173).** Only `id`, `orgId`, `name`, `role` are non-nullable at the DB layer. Everything else — `email`, `phone`, `passwordHash`, `employeeCode` — is optional.

**`pending_verification` — confirmed: this is NOT a new status value that needs adding anywhere.** There is no `UserStatus` enum in the schema at all (`grep -n "UserStatus" prisma/schema.prisma` → zero hits). The *only* login gate is the existing `isActive` boolean — confirmed at `app/api/auth/login/route.ts:62`, `.eq("is_active", true)`. Creating the `User` row with `isActive: false` **already fully implements** "blocks login until HR later flips it active." Nothing new to add to the enum/schema for this requirement.

**How `employeeCode` is generated today — it isn't; it's always manually typed by a human.** `grep -rn employeeCode` across `app/` + `lib/` turns up exactly two producers: (1) `app/join/join-form.tsx` — a public applicant types their own code into a text field, validated by a regex, no generator function; (2) HR types it manually when editing a user. The schema comment on the column says why: `// referenced from Humansoft HR app` — the real code is assigned by an *external* payroll system (Humansoft), and someone copies it in by hand. There is no `generateEmployeeCode()` function anywhere in the repo. Since this spec's 41-question form never asks for an employee code, recommend leaving `employeeCode: null` at creation and letting HR fill it in later via the existing user-edit screen (`PATCH /api/admin/users/[id]`) once Humansoft assigns the real one — this changes nothing structurally and matches how the *only* other public-submission-to-User flow (register-request) already differs: that one DOES collect employeeCode from the applicant; ours doesn't, per the locked spec.

**Transaction mechanism — this is a genuinely new pattern for this codebase.** `grep -rn 'prisma.\$transaction'` across `lib/` + `app/` returns **zero hits**. Every existing "public form → HR approves → creates User" flow (`app/api/admin/register-requests/[id]/route.ts`, read in full) uses the Supabase admin client with **sequential, un-transacted** `.insert()` calls — `users` insert, then `user_branches` insert, then `register_requests` update, each capable of independently failing and leaving partial state. That's an existing gap I'm flagging, not silently copying — the locked spec explicitly demands atomicity, so this is the first place in the codebase that should actually use `prisma.$transaction([...])`. `prisma` is already the live client for reads/writes in both DocuFlow and Recruit's own upload route, so this isn't introducing a new dependency, just a new call pattern.

Recommended transaction (HR-approve action), as one `prisma.$transaction([...])` array:
1. `prisma.user.create({ data: { orgId, name: submission.fullNameTh, phone: submission.phone, email: submission.email, role: "staff", employeeCode: null, isActive: false, mustChangePassword: true, inviteToken, inviteExpiresAt, invitedBy: session.user.id } })`
2. `prisma.userBranch.create(...)` — only if `submission.branchId` is set (self-reported branch resolved to a real `Branch` row already, see §1)
3. `prisma.recruitOnboardingSubmission.update({ where: { id }, data: { status: "APPROVED", reviewedById, reviewedAt: now, resultUserId: newUserId } })`
4. `prisma.auditLog.create(...)` — the standalone `audit()` helper (`lib/audit/log.ts`) uses the *Supabase* admin client, not Prisma, so it can't literally sit inside a `prisma.$transaction` array. Recommend inlining the equivalent `prisma.auditLog.create()` call (the `AuditLog` model is a real Prisma model — confirmed via `User.auditLogs AuditLog[]`) so the audit trail commits atomically with everything else, rather than calling the existing `audit()` helper *after* the transaction (which is what `register-requests/[id]` currently does, and is an acceptable-but-slightly-weaker pattern if this one's exact atomicity is not worth the duplication).

**Open design question — password setup timing.** The existing invite mechanism (`inviteToken` + `inviteExpiresAt`, 48h, `makeToken()` in `register-requests/[id]/route.ts`) is how every other HR-approved user currently sets their password. Our new hire already did everything else (form, docs, signature, selfie) *before* any `User` row exists, so there's no natural "invite acceptance" moment left in the flow. Recommend generating the invite token in the **same** atomic transaction as approval (step 1 above) and sending it in the **same** email/LINE message as the signed contract PDF (§ task requirement) — so the new hire can set a password right away, while `isActive: false` still hard-blocks login until HR's *separate*, later "flip active" step (see §3 below — this reuses an existing endpoint, not a new one). Flagging this timing choice for PM/UX sign-off since the locked spec doesn't spell out exactly when password setup happens, only that login stays blocked until the second HR action.

---

## 3. API route surface

**Public (no session, rate-limited — see §6):**
| Route | Purpose |
|---|---|
| `POST /api/recruit-onboarding/submit` | Full 41-answer form submit → creates `RecruitOnboardingSubmission` (status `SUBMITTED`). Fixed zod schema (not `buildAnswerValidator`-style dynamic, since the form isn't admin-configurable). Server-revalidates 18+ from `birthDate`. |
| `POST /api/recruit-onboarding/upload-drive` | File upload proxy to Drive for the 6 document types. **New route, not a reuse of `/api/recruit/upload-drive`** — see §4, that route hard-requires an `OPEN RecruitJobPosting` by `slug`, which structurally cannot exist here (no posting link at all, permanent standalone URL). |
| `POST /api/recruit-onboarding/[submissionId]/consent` | Signature PNG + live selfie JPEG + contract content-hash + scroll-gate flag → creates the `RecruitOnboardingConsent` row (and 2 `RecruitOnboardingDocument` rows via the same upload helper, `docType: SIGNATURE`/`SELFIE`). This is what the adapted signer component (§5) posts to — replaces the hardcoded DocuFlow URL `/api/docuflow/${documentId}/signatures/${placement.id}/sign` the current component calls. |

**HR-facing (session + role-gated — reuses `lib/recruit/role-guard.ts`, read in full):**
| Route | Gate |
|---|---|
| `GET /(admin)/recruit-onboarding` — review list page | `requireRecruitAccess()` (`RECRUIT_ROLES`: super_admin/org_admin/admin/program_admin/area_manager/branch_manager/viewer — read-only) |
| `POST /api/recruit-onboarding/[submissionId]/approve` — runs the §2 transaction | See note below — recommend `RECRUIT_ADMIN_ROLES`, not the broader `RECRUIT_WRITE_ROLES` |
| `POST /api/recruit-onboarding/[submissionId]/reject` | Same gate as approve |
| (second, later step) **flip `isActive: true`** | **Reuse the existing `POST /api/admin/users/[id]/reactivate` route as-is** — see finding below |

**Gate tightness call-out:** `RECRUIT_WRITE_ROLES` (`lib/recruit/role-guard.ts` line 24) includes `area_manager` and `branch_manager` — appropriate for "create/edit a job posting," but creating a *real login account* with PII (national ID, bank account) feels like it warrants the narrower `RECRUIT_ADMIN_ROLES` (super_admin/org_admin/admin/program_admin only, line 34). Flagging this as a PM/CEO call, not deciding it myself — both are one-line changes.

**Found while reading `app/api/admin/users/[id]/reactivate/route.ts` in full: the "HR later flips it active" step already exists, verbatim.** It does exactly `is_active: true, failed_login_count: 0, locked_until: null` and nothing else — no new endpoint needed for that half of the flow. **One real gap**: it's gated to `requireRole("super_admin", "org_admin", "admin")` only — `program_admin` is *not* in that allowlist, even though `RECRUIT_ADMIN_ROLES` (which *does* include `program_admin`) is meant to be the "full recruit admin" tier per `lib/recruit/role-guard.ts`'s own comment (`// program_admin ... gets full recruit admin`). If a Recruit `program_admin` HR user is expected to complete the *whole* onboarding flow solo (approve + later activate), they'll hit a 403 on the activation half via the existing route. Flag to PM: either widen `reactivate`'s role check to include `program_admin`, or accept that final activation is admin-tier-only by design (a reasonable "two sets of eyes" control, but should be an explicit decision, not an accident).

---

## 4. `app/api/recruit/upload-drive/route.ts` — what it does today, and what changes

Read in full. Today it:
- Rate-limits `recruit-upload-drive:ip:${ip}` at 20/15min (via `checkRateLimit`).
- Requires a `slug` in the form body, looks up `prisma.recruitJobPosting.findUnique({ where: { slug } })`, and **hard-rejects if `posting.status !== "OPEN"`** (line 73-75). This is the structural blocker: our onboarding flow has no posting at all (locked spec: standalone, no FK to `RecruitApplication`/`RecruitJobPosting`), so this exact gate cannot be satisfied and the route cannot be reused unmodified.
- Validates MIME against `ALLOWED_FILE_MIMES` (`lib/recruit/types.ts` — PDF/Word/jpeg/png/webp) and caps at 4MB (server body-limit headroom; bigger files are meant to fall back to R2, but note the spec doesn't want R2 here at all — see below).
- Delegates to `uploadApplicantFileToDrive()` (`lib/recruit/drive.ts`), which calls the shared ChairOps Drive OAuth session (`getDriveSession(orgId)` from `lib/chairops/storage/drive.ts` — **the Drive connection is a single shared per-org OAuth grant, reused across modules; it's not module-specific despite living under a `chairops/` path**), creates/reuses a folder named `"Recruit — ใบสมัครงาน"`, uploads, and **always calls `makePublic()` — "anyone with link" reader, unconditionally** (comment: *"Recruit files ARE meant to be viewable via link ... unlike ChairOps' sensitive slips"*).

**That public-by-default behavior is a real problem for this feature and should NOT be reused as-is.** Applicant resumes are one thing; this flow's documents are Thai national ID card, house registration, and bank book photos — materially more sensitive PII, closer to ChairOps' "sensitive slips" than to a resume. The codebase already has the *right* default sitting right next to it: `lib/chairops/storage/drive.ts`'s `backupFileToDrive()` / `makeAnyoneReader()` (line 270) is **private by default**, gated behind an explicit `CHAIROPS_DRIVE_PUBLIC_LINKS=1` env flag, with the comment *"files (maid contracts, bank slips) are SENSITIVE, so 'anyone-with-link reader' is OFF by default."*

**Recommendation for the new route:** build `app/api/recruit-onboarding/upload-drive/route.ts` as a sibling, not a modification of the existing one (different validation entirely — no slug/posting check, uses `submissionId` instead), reusing the low-level `ensureFolder()`/upload-bytes primitives from `lib/chairops/storage/drive.ts` (or a near-identical copy under `lib/recruit-onboarding/drive.ts`), **without** calling `makePublic`/`makeAnyoneReader` — i.e., private-by-default like ChairOps, not public-by-default like today's applicant-resume route. Folder name should be distinct too (e.g. `"Recruit — เอกสารพนักงานใหม่"`) so onboarding PII doesn't land in the same public-linked folder as applicant resumes.

---

## 5. `components/docuflow/signer-interface.tsx` — what it needs, and what a public unauthenticated route needs to change

Read in full (297 lines). Key facts:
- The `requireSession()` call is **not** inside this component — it's one layer up, in the page wrapper `app/sign/[placementId]/page.tsx` (line 37) and again inside the API route it posts to (`/api/docuflow/[id]/signatures/[placementId]/sign/route.ts`, line 57). The component itself just takes props (`documentId`, `documentName`, `pdfUrl`, `placement`, `signerDisplayName`) — so in principle it's decoupled from auth.
- In practice it's still tightly coupled to **DocuFlow's specific concerns** that don't apply to our flow: it renders a PDF via `react-pdf` with a placement overlay box (`SignaturePlacementBox`) highlighting *where* on a page to sign — irrelevant here, since our contract is a plain scrollable page with a consent checkbox that unlocks only after scroll-to-end, not a PDF with annotation boxes. And its submit handler POSTs to a hardcoded DocuFlow URL (`/api/docuflow/${documentId}/signatures/${placement.id}/sign`).
- **The reusable part is narrow and specific**: the fullscreen signature-pad modal UX (`SignatureFullscreenPad` — open/clear/submit, `react-signature-canvas`, mobile-sized touch target, sticky bottom CTA). That's worth carrying over as a pattern/reference, not as a drop-in import, since everything around it (PDF viewer, placement box, submit URL) needs to be stripped or replaced.

**A better existing precedent for the "public, no session" wrapper exists and should be used instead of `/sign/[placementId]`'s pattern:** `app/sign/rentspace/[token]/page.tsx` + `_components/sign-pad.tsx` (read both in full) is a genuinely public (no `requireSession()` anywhere in the chain), token-gated signing flow already live in production for RentSpace tenant contracts — plain `<canvas>` + pointer events (no `react-signature-canvas` dependency), a server action (`_sign-action.ts`) instead of a fetch-to-API-route, and a "read the whole contract, then sign" page layout structurally identical to what this feature needs. Recommend modeling the new onboarding sign page on **this** precedent, not on `/sign/[placementId]`.

Note: neither existing signing flow (DocuFlow's or RentSpace's) captures IP/user-agent/content-hash today — that legal-hardening pattern only exists on `ChairopsMaidContract` (§1). Building it into the new `/api/recruit-onboarding/[submissionId]/consent` route is net-new work either way, just modeled on ChairOps' field shape rather than copied from a working endpoint.

**Live-selfie-capture — found a ready-made, production component to reuse directly: `components/playland/face-capture.tsx`** (`FaceCapture`, read in full, 257 lines). It already does exactly what's asked: `getUserMedia`-based live webcam capture, explicit user-gesture-gated permission prompt (browsers silently fail auto-triggered `getUserMedia`, so it correctly waits for a click), classifies camera errors into actionable Thai messages (denied/no-camera/in-use/unsupported), crops to a 480×480 JPEG data URL. **One nuance to flag**: it also offers a **file-upload fallback** (`mode: "upload"`, plus a hidden `<input type=file capture=user>` for the "phone native camera" path) for when webcam access fails or isn't available — the locked spec says "live selfie capture (camera, not file upload)," which is a slightly stricter requirement than what this component enforces out of the box. Recommend reusing it as-is (the fallback exists precisely so a camera-permission-denial or no-webcam laptop doesn't hard-block a new hire from finishing onboarding) but flagging the literal-vs-pragmatic tension to PM/UX for an explicit call: keep the fallback (my recommendation — hard-blocking on camera failure with no PII-photo alternative seems like the wrong trade-off for a hiring flow) or strip it to match the spec text exactly.

---

## 6. Rate limiting for the new public routes

**The mechanism already exists and is used consistently — reuse it, don't build anything new.** `lib/rate-limit/index.ts` (read in full): `checkRateLimit({ bucket, max, windowSec })` is DB-backed (table `rate_limit_attempts`, no Redis/Upstash dependency), atomically checks-and-records in one call, and is already the go-to across ~10 routes (`register-request`, `recruit/upload-drive`, `forgot-password` (dual IP+email buckets), `cashhub/ocr-slip`, `cashhub/ai`, `pinpoint/sessions`, `bugs`, `auth/check-login`). `getClientIp(req)` (same file) reads `x-forwarded-for`/`x-real-ip`/`cf-connecting-ip` — already Vercel-aware.

Proposed buckets for the 3 new public routes (each keyed `bucket: "recruit-onboarding-<action>:ip:${ip}"`):

| Route | Proposed limit | Rationale |
|---|---|---|
| `submit` (41Q form) | 5 / IP / 24h | Mirrors `register-request`'s exact number+window (`app/api/auth/register-request/route.ts:48-52`) — the closest existing analog: a public "I want to join" action with zero identity gating. |
| `upload-drive` | 20 / IP / 15min | Reuse the exact number already proven on `/api/recruit/upload-drive` (line 29-33) — same shape of action (one file per call, multiple calls per person completing a multi-document upload step). |
| `[submissionId]/consent` (signature+selfie) | 10 / IP / 24h | Tighter than upload — each hit does 2 image uploads to Drive plus a DB write; a legitimate person only ever calls this once per submission (retries aside). |

**Residual risk, already accepted by the locked spec, not something to solve here:** since there is genuinely zero per-person access control (no OTP, no token), a shared-IP scenario (e.g. several new hires filling the form from the same office WiFi, or behind a corporate NAT) could hit the IP bucket and false-positive-lock out a *later legitimate* submitter, not just an attacker. The spec explicitly names rate-limiting-by-volume as the accepted mitigation instead of identity gating — flagging the shared-IP trade-off for visibility, not proposing to relitigate the "no OTP" decision.

---

## Summary of things other personas need to know

- **No new `UserStatus` enum, no schema migration needed on `User` for "pending_verification."** `isActive: false` at creation already blocks login (confirmed at the login route). The "later flip to active" step is `POST /api/admin/users/[id]/reactivate`, which **already exists** — but is currently gated to admin-tier only, not `program_admin` (flagged for PM decision).
- **`employeeCode` is always manually typed by a human, sourced from an external HR system (Humansoft) — there is no generator function anywhere in the repo.** Leave it `null` at creation.
- **This is the first `prisma.$transaction` usage in the codebase.** Existing "approve → create User" flows (register-request) are NOT atomic today; ours should be, per spec.
- **Do not reuse `/api/recruit/upload-drive` as-is** — it hard-requires an `OPEN RecruitJobPosting.slug` (structurally impossible here) and makes every file **publicly link-readable**, which is wrong for ID cards/bank books. Build a sibling route modeled on ChairOps' **private-by-default** Drive pattern instead.
- **`signer-interface.tsx` is DocuFlow-specific (PDF+placement-box UI, hardcoded submit URL); `app/sign/rentspace/[token]/` is a better structural precedent** for a genuinely public, session-free sign page.
- **`components/playland/face-capture.tsx` is a ready-made, production-proven live-selfie component — reuse directly**, just flag its built-in upload-fallback against the spec's "camera, not file upload" wording.
- **Rate limiting: reuse `lib/rate-limit/index.ts`'s `checkRateLimit`/`getClientIp` as-is** — no new utility needed. Proposed numbers above.
