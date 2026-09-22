# BIGFEATURE · Recruit Onboarding · Persona QC (Quality Control / Conventions)

> **Created:** 2026-09-22 · 13-persona roundtable, QC seat
> Scope is locked (see roundtable brief — "ระบบรับพนักงานใหม่ออนไลน์"). This doc does not re-debate flow/legal/UX. It answers ONE question: **"when BE/FE actually writes this, which exact existing function/constant/file do they call — and which exact anti-pattern from this repo's own history must they not repeat."**
> All citations below were verified by reading the real files in `~/Code/pooilgroup/legacy/pooilgroup-web` on 2026-09-22, not guessed from memory.

---

## 1 · Role gate for HR-review/approve routes

**File:** `lib/recruit/role-guard.ts` — confirmed, exact signatures:

```ts
export const RECRUIT_ROLES: DbUser["role"][] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager", "viewer",
];

export const RECRUIT_WRITE_ROLES: DbUser["role"][] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager",
];

export const RECRUIT_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin", "org_admin", "admin", "program_admin",
];

export function requireRecruitAccess(role: DbUser["role"]): void
export function requireRecruitWrite(role: DbUser["role"]): void
export function requireRecruitAdmin(role: DbUser["role"]): void   // redirect("/recruit") if not in RECRUIT_ADMIN_ROLES
export function canRecruitWrite(role: DbUser["role"]): boolean
export function canRecruitAdmin(role: DbUser["role"]): boolean
```

**Which one to use for this feature:** HR reviewing a submission and clicking Approve/Reject is a **sensitive op that creates a `User` row** — the same tier as "Blacklist remove / settings" per the file's own doc-comment. Use **`requireRecruitAdmin(session.user.role)`** (server action) or **`canRecruitAdmin(role)`** (to conditionally render the Approve button) — not `requireRecruitWrite`, which is meant for posting/status-edit ops one tier lighter. `lib/recruit/erasure-actions.ts:13` already does exactly this for a comparable sensitive decision: `if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");`.

Note the file's own top comment: `program_admin` only gets these powers because the `/recruit` layout already gates entry on an active `user_modules` "recruit" grant first — don't re-derive a parallel allowlist, reuse this file's exports directly.

---

## 2 · Audit-log pattern

**Two DIFFERENT audit helpers exist in this repo — use the Recruit one, not the ChairOps one.**

### 2a. `lib/audit/log.ts` — the one Recruit already uses everywhere
```ts
export async function audit(entry: AuditEntry): Promise<void>
interface AuditEntry {
  orgId: string;
  userId: string | null;
  action: AuditAction;       // big union type, see below
  resourceType: string;
  resourceId?: string;
  diff?: { old?: Record<string, unknown>; new?: Record<string, unknown> };
  ipAddress?: string;
  userAgent?: string;
}
```
Writes to `audit_logs` via `adminClient()` (Supabase client, **not** Prisma) — it is a **best-effort side-call**, not participating in any `prisma.$transaction`. Confirmed real call sites already in Recruit:
- `app/apply/[slug]/submit-action.ts` (public submission, no session): `await audit({ orgId: posting.orgId, userId: null, action: "RECRUIT_APPLICATION_SUBMITTED", resourceType: "recruit_application", resourceId: application.id, diff: {...} })` — **this is the exact shape for a public/no-session submit call: `userId: null`, `orgId` resolved server-side, never trusted from the client.**
- `app/api/admin/register-requests/[id]/route.ts` — on approve, calls `audit()` **twice**: once `APPROVE_REGISTER_REQUEST` on the request row, once `CREATE_USER` on the newly-created user row (`resourceId: userId`). **This is the direct precedent for HR's approve action on this new feature** — do the same: one audit entry for the submission-approved event, one separate `CREATE_USER` entry.
- `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts:163` — on a signature being captured, calls `audit({ ..., action: "DOCUFLOW_SIGNATURE_SIGNED", diff: { new: { signedAt: ... } } })`. **Use this as the template for the moment the candidate signs the contract.**

**You must add new `AuditAction` union members** in `lib/audit/log.ts` (it's a closed string-literal union, ~150 entries already, organized by module with a comment banner per module e.g. `// Recruit module — รับสมัครพนักงาน`) — e.g. `RECRUIT_ONBOARDING_SUBMITTED`, `RECRUIT_ONBOARDING_APPROVED`, `RECRUIT_ONBOARDING_REJECTED`, `RECRUIT_ONBOARDING_SIGNED`. Do not invent a generic action string outside the union — TypeScript will refuse to compile it, which is the intended guardrail.

For IP/User-Agent capture on the public submit + sign endpoints, use `lib/audit/request-meta.ts`'s `getRequestMeta(req)` helper (spreads `{ ipAddress, userAgent }` into the `audit()` call) — added per Finance-audit requirement that sensitive routes must record "เครื่องไหน IP อะไร."

### 2b. `lib/chairops/audit/log.ts` — do NOT use this one here
This is a **ChairOps-only** parallel audit system (`writeAudit()`, writes to `chairopsAuditLog` via Prisma) whose entire reason to exist is that it accepts a `tx` client so the audit row can be written **inside** the same `prisma.$transaction` as the mutation. Recruit's `audit()` cannot do this (it's a separate Supabase client call). This is a real architectural inconsistency already in the codebase, not something to fix here — just don't mix them. Recruit's own `erasure-actions.ts` and `submit-action.ts` both call `lib/audit/log.ts`'s `audit()` as a **post-transaction best-effort call**, which is the convention to keep for consistency with the rest of Recruit.

### 2c. Immutable/WORM pattern (for the "immutable consent/audit record" in the locked spec)
`audit_logs` itself is already enforced append-only at the DB level: `supabase/migrations/20260520000006_audit_log_immutable.sql` adds `BEFORE UPDATE`/`BEFORE DELETE` triggers on `audit_logs` that `RAISE EXCEPTION` unconditionally — survives even `service_role`/`adminClient()` bypass. **If the new consent/audit record is its own dedicated table** (not just `audit_logs` rows), copy this exact trigger pattern onto the new table in its migration — this is the only proven "actually immutable, not just convention" mechanism in this codebase. Don't rely on "we just won't call `.update()` on it" as the guarantee.

---

## 3 · Rate-limiting utility

**File:** `lib/rate-limit/index.ts` — DB-backed (table `rate_limit_attempts`, no Redis/Upstash dependency). Exact signatures:

```ts
export async function checkRateLimit(opts: { bucket: string; max: number; windowSec: number })
  : Promise<{ limited: boolean; remaining: number; retryAfterSec: number; count: number }>

export function getClientIp(req: Request): string   // reads x-forwarded-for / x-real-ip / cf-connecting-ip
```

**Do not build a new rate limiter.** Real call sites to copy the shape from:
- `app/api/recruit/upload-drive/route.ts:29` — `checkRateLimit({ bucket: `recruit-upload-drive:ip:${ip}`, max: 20, windowSec: 15 * 60 })` — **directly reusable for this feature's document-upload endpoint**, same bucket-naming convention (`<feature>-<action>:ip:<ip>`).
- `app/api/auth/register-request/route.ts:48` — `checkRateLimit({ bucket: `register:ip:${ip}`, max: 5, windowSec: 24*60*60 })` — closest precedent for a "public form submission that creates a pending-review record," same shape this feature's final-submit endpoint should use.
- `app/api/auth/forgot-password/route.ts` — shows the **dual-bucket pattern** (IP bucket + a second identity-bucket, e.g. email/phone) for endpoints where IP alone isn't enough — worth copying if the onboarding submit endpoint should also rate-limit per phone/ID-card-number to stop one person retry-spamming.

**Gap to flag explicitly:** `app/apply/[slug]/submit-action.ts` (the closest sibling flow, Server Action not API route) has **no `checkRateLimit` call at all** — only the upload endpoints it calls are rate-limited. Don't copy that gap. This new feature's public submission has NO login and a permanent URL (no slug/posting to naturally scope abuse to), so it is a strictly higher spam-risk surface than `/apply/[slug]` — the final "submit onboarding" action must call `checkRateLimit` itself (IP bucket, and consider a national-ID or phone bucket too, mirroring forgot-password's dual-bucket pattern), not just rely on the per-file upload endpoint's limiter.

---

## 4 · orgId / companyId scoping — concrete answer, this is single-tenant with a hardcoded org

**Confirmed from `prisma/seed.ts:2`: `// 1 organization (Pooilgroup) → 2 companies (Pooil Oil + JP Sync) → sample of all 11 business types`.** This deployment has exactly **one** `Organization` row, id hardcoded as:

```ts
const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";
```

This exact constant is **redefined inline as a local const in 8+ files** (`app/join/page.tsx`, `app/api/auth/signup/route.ts`, `app/api/auth/register-request/route.ts`, `app/api/telegram/webhook/route.ts`, `app/(auth)/signup/page.tsx`, `app/(auth)/login/page.tsx`, `prisma/seed.ts`, `prisma/seed-chairops.ts`) — no single shared import exists except `lib/rentspace/format.ts:23` which re-exports it as `export const POOILGROUP_ORG_ID = ORG_ID`. **This repeated-inline-const pattern is itself a pre-existing minor inconsistency** — new code for this feature should import from `lib/rentspace/format.ts` if reasonable, or at minimum follow the same literal-constant convention rather than inventing a 9th copy or (worse) trying to look up "the org" dynamically. **orgId for this feature = this literal constant, resolved server-side, never accepted from the client**, exactly like `app/api/recruit/upload-drive/route.ts` resolves `posting.orgId` server-side from the DB row rather than trusting a client-sent `orgId`.

**Company mapping — this directly answers "does field #1 map to a real model":**

`prisma/schema.prisma:122` `model Company`:
```prisma
model Company {
  id      String  @id @default(uuid()) @db.Uuid
  orgId   String  @map("org_id") @db.Uuid
  code    String  // POOIL | JPSYNC
  name    String  // "Pooil Oil" | "JP Sync Group"
  ...
  @@unique([orgId, code])
}
```
Confirmed at `prisma/schema.prisma:6583`: `// 3-tier tenancy: org_id + company_id + branch_id · RLS org_id = current_org_id()`. **Yes — the "company" the candidate picks in form field #1 (พีโอออยล์ / เจพีซิงค์ กรุ๊ป) IS the real `Company.code` field (`POOIL` | `JPSYNC`), not `orgId`.** `orgId` is constant/shared for the whole deployment; `companyId` is the actual per-tenant-like scoping dimension for this feature. `RecruitJobPosting` (`prisma/schema.prisma:1327-1330`) is the closest existing model and already carries **both** `orgId` (required) and `companyId` (optional, `String?`) — copy this exact two-column shape onto the new submission model: store both `orgId` (= the fixed constant) and `companyId` (resolved server-side by looking up `Company.findFirst({ where: { orgId: POOILGROUP_ORG_ID, code: <value candidate picked> } })` — **never trust a client-sent `companyId` UUID directly, only the `code` string, then resolve the real row server-side**, same defensive pattern the upload-drive route uses for `slug`→posting lookup).

**Concrete flag for SA/BE:** because there is genuinely no session and no `RecruitJobPosting`/slug to derive `orgId`/`companyId` from (unlike `/apply/[slug]`), this feature is the **first** Recruit flow where `orgId` must come from a hardcoded constant rather than a DB lookup chain. That's fine (`register-request`, `signup`, `join` all already do exactly this), but it must be done explicitly and server-side, not left implicit.

---

## 5 · `employeeCode` generation

**There is no generation function.** Confirmed by repo-wide search: `employeeCode` does not have a `generate*()` function anywhere. `prisma/schema.prisma:176`:
```prisma
employeeCode  String?  @map("employee_code")  // referenced from Humansoft HR app
```
It is a **free-text field HR types in manually**, referencing an ID that already exists in the external Humansoft HR system — confirmed by `app/api/auth/register-request/route.ts`'s zod schema (`employeeCode: z.string().min(2)...regex(/^[A-Za-z0-9-]+$/)`) which is filled from a form input, and by `app/join/join-form.tsx` which also collects it as free text from the user.

**Implication for this feature:** don't invent an auto-generated employee code. Either (a) leave `employeeCode` null until someone later keys it in from Humansoft (matches the field's documented purpose), or (b) if HR wants to type it in at approve-time, add a plain text input on the approve screen — same UX as `register-request`'s flow, not a new sequence/counter.

---

## 6 · Lint / typecheck / build — exact commands, cited from `package.json` + `CLAUDE.md`

```json
// package.json
"build": "prisma generate && node scripts/check-prisma-table-map.mjs && node scripts/check-schema-applied.mjs && next build",
"lint": "eslint",
```

`CLAUDE.md` §"🧪 Verification before Done" (lines 150-156): `npm run build` ต้องผ่าน · ถ้าแตะ critical route → curl/Playwright · ถ้าแตะ schema → `prisma db push` บน dev DB ก่อน production · **`git push` ≠ deploy prod** — Vercel ต้องกด "Redeploy" เอง.

Real-world verify recipe used consistently across `STATUS-archive.md` entries (this is the de-facto `/verify` gate this project runs before calling anything "done"):
```
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit     # tsc OOMs without this flag on this repo
npm run lint                                                  # eslint, must be 0 error on touched files
npm run build                                                 # prisma generate + table-map check + schema-applied check + next build
```
Plus, since this feature touches money-adjacent HR/identity data and creates real login-capable rows: **smoke-test with curl** on the new public form URL + the HR review route + `/login` after deploy (the standard pattern every `STATUS-archive.md` verify entry follows, e.g. `smoke test /` `/health` `/<module>` `/login` → expect 200/307 as appropriate).

Also always `EnterWorktree` first — `CLAUDE.md` line 123: **"ห้ามแก้ไฟล์/commit ใน main working tree เด็ดขาด"** — this repo is actively used by multiple concurrent Claude sessions; direct commits to the main checkout have caused real push conflicts (documented 2026-08-23, recurred 2026-09-20 per active memory). Confirmed no `verify-gate.py` file lives inside this repo (it's an external git hook referenced by `CLAUDE.md` line 125) — don't try to bypass it with `VERIFY_SKIP=1`.

---

## 7 · Anti-patterns to explicitly avoid (with exact evidence)

### (a) Shared mime/size-allowlist constant — must NOT touch the one `/apply/[slug]` depends on

`lib/recruit/types.ts` defines, currently shared by **three** live call sites:
```ts
export const ALLOWED_FILE_MIMES = [
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg", "image/png", "image/webp",
] as const;
export const ALLOWED_FILE_EXTENSIONS = [...] as const;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;           // 5 MB
export const MAX_FILES_PER_APPLICATION = 3;
```
Confirmed live consumers: `app/api/recruit/upload-drive/route.ts`, `app/api/recruit/upload/route.ts`, `components/recruit/public-form-renderer.tsx` — all currently power the **live** `/apply/[slug]` applicant flow. This feature needs 6 documents (likely different types — ID card, house registration, possibly different size/type needs for a live selfie capture vs. a PDF resume) and a live-selfie capture, which is a materially different allowlist shape than "resume + portfolio." **Define a separate constant set** (e.g. `RECRUIT_ONBOARDING_ALLOWED_MIMES`, `RECRUIT_ONBOARDING_MAX_FILE_SIZE`, in a new file like `lib/recruit/onboarding/types.ts`, mirroring how `lib/recruit/types.ts` itself is scoped) — tightening or loosening `ALLOWED_FILE_MIMES`/`MAX_FILE_SIZE` in place would silently change behavior on the live `/apply/[slug]` applicant flow, which has nothing to do with this feature. Also note the upload-drive route's own body-size ceiling: `MAX_DRIVE_UPLOAD = 4 * 1024 * 1024` (4 MB, Vercel serverless body-limit headroom) — if onboarding docs/selfies can be larger, that constant needs its own onboarding-scoped equivalent too, for the same reason.

### (b) Silent token/link revocation without a clear user-facing message

Not directly applicable to the happy path here (locked spec explicitly has **no token/reference-code system** — one permanent URL), but relevant wherever HR-facing share/invite links appear in this feature's admin side (e.g. if HR gets a "review link" to send a candidate, or an invite-link is generated after approval to let the new hire log in). Documented real incident: ChairOps invite-link re-issuance silently revoked the previous link with no user-facing message, and separately, old/expired invite links surfaced a bare error instead of routing an already-linked account through login (active memory: `invite-link-ttl-standardize-and-chairops-branch-bug-2026-09-20`). The pattern already fixed elsewhere in this same work (standardized to a 24h TTL) should be followed for any link this feature issues after approval, and any revocation must show the affected party a clear reason, not fail silently.

### (c) Creating a `User` row before the transaction is fully ready (half-written employee records)

**Two real precedents to combine, not contradict:**

1. `app/(admin)/chairops/users/actions.ts:108-160` — creates a Supabase Auth user **first** (external system, can't be transactional with Postgres), then wraps the Prisma-side `ChairopsUser` create + related-row inserts + `writeAudit()` in one `prisma.$transaction(async (tx) => {...})`, and **explicitly rolls back the auth user in a `catch` block if the Prisma transaction fails**: `await supabase.auth.admin.deleteUser(authData.user.id)`. This is the correct pattern *only* because it spans two independent systems.
2. `app/api/admin/register-requests/[id]/route.ts:90-146` (approve flow) — by contrast, does **sequential, non-transactional** Supabase-client `.insert()`/`.update()` calls (`users` insert → `user_branches` insert → `register_requests` update → two `audit()` calls) with **no rollback if a later step fails**. This is a real gap already in production code, not a pattern to copy.

**This feature's approve flow is entirely within Postgres** (submission row → consent/audit row → `User` row, no external system involved), so there is no excuse to do it the `register-requests` way. Use `prisma.$transaction(async (tx) => {...})` (confirmed the dominant convention — 300+ call sites across `lib/ledger`, `lib/clawfleet`, `lib/playland`, `lib/dc`, `app/(admin)/chairops/**`, and already inside Recruit itself at `lib/recruit/erasure-actions.ts:36`) so the submission-approved update, the `User` insert, and any related rows commit or roll back together — call `audit()` (the Recruit-standard one, §2a above) **after** the transaction commits, as `submit-action.ts` and `erasure-actions.ts` both already do, since `audit()` can't participate in the Prisma transaction itself (§2b).

**Team's own locked decision (see `WORKSHOP_recruit-employee-onboarding.md` §3.4, §4.4):** the `User` row is created **once**, atomically, at the moment the contract is signed — **not** as a draft row created earlier and patched later. Its initial status is `pending_verification`; HR's later "confirm" is an `UPDATE`, never a second `INSERT`. This matches anti-pattern (c) correctly *if and only if* the whole "signature captured + consent record + `User` insert (born `pending_verification`)" sequence is one `prisma.$transaction` — don't let the `User` insert happen in a separate call from the consent-record insert, or a crash between the two produces exactly the half-written state this rule exists to prevent.

**One more concrete gap the team's own workshop doc surfaces (flag for SA/BE, not yet answered by existing code):** `lib/auth/session.ts:49-65`'s `getSession()` is the **single chokepoint** every module in this codebase relies on to resolve a session — it gates on `.eq("is_active", true)` (line 62) and nothing else. There is currently **no** `pending_verification` concept anywhere in the schema or this function. `isActive=false` already carries an existing, different meaning across the codebase (deactivated-for-cause, e.g. the access-review cron flips it off). **Reusing `isActive=false` for "not yet HR-verified" risks colliding with that existing semantics** (e.g. an access-review job or an admin "deactivate" action could no longer be distinguished from "pending new hire"). Recommend a **separate new field** (not overloading `isActive`), and the central check must land in `lib/auth/session.ts`'s `getSession()` query (line 62 is the literal place), since every module's login/session resolution funnels through this one function — a Recruit-local guard would not be sufficient (this exact risk is already called out in the BA persona's AC-S1 and the workshop's Integration Map).

---

## Summary table — exact things to import, not reinvent

| Need | Import from | Exact export |
|---|---|---|
| HR admin gate | `@/lib/recruit/role-guard` | `requireRecruitAdmin`, `canRecruitAdmin` |
| Audit log | `@/lib/audit/log` | `audit()`, add new `AuditAction` members |
| Request IP/UA for audit | `@/lib/audit/request-meta` | `getRequestMeta(req)` |
| Rate limit | `@/lib/rate-limit` | `checkRateLimit()`, `getClientIp()` |
| Fixed org id | inline constant, see `lib/rentspace/format.ts:23` | `POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001"` |
| Company resolution | `prisma.company.findFirst({ where: { orgId, code } })` | `Company` model, `code` = `POOIL` \| `JPSYNC` |
| Atomic multi-row write | `@/lib/prisma` | `prisma.$transaction(async (tx) => {...})` |
| Existing sibling precedent (closest flow) | `app/apply/[slug]/submit-action.ts`, `app/api/admin/register-requests/[id]/route.ts` | read both in full before writing the new submit/approve actions |

**Do NOT reuse as-is:** `ALLOWED_FILE_MIMES` / `MAX_FILE_SIZE` from `lib/recruit/types.ts` (define a separate onboarding-scoped set) · the sequential non-transactional insert pattern in `register-requests/[id]/route.ts` (use `$transaction` instead) · `lib/chairops/audit/log.ts`'s `writeAudit()` (wrong module, use `lib/audit/log.ts`'s `audit()`).
