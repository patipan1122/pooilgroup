# Audit · ChairOps Maid Management · 2026-06-05

> Mode: **Reverse Audit** (post-implement compliance check)
> Roster: SA · BA · FE · QA · DEVIL · SEC · SRE (7 personas)
> Branch audited: `claude/chairops-maid-management-9features` · commit `9c6fe3d`
> Build state at audit: tsc 0 · next build GREEN
> Spec: `docs/WORKSHOP_chairops-maid-management.md`

---

## 1. Executive Summary

9 features (F1–F9) were built in a single context pass and committed to the branch. All 9 must-have features exist in working code. Architecture is sound: TOCTOU-safe settle gate, `(maid-public)` route group for redirect-loop prevention, dual HMAC+DB invite validation, `getMaidUserRaw()` raw bypass for F9.

Audit found **3 P0 bugs** (all fixed before this commit), **8 P1 items** (5 fix-before-pilot, 3 CEO-decision), and **4 P2 polish items**.

**Overall verdict:** ✅ PASS after P0 fixes applied in this audit commit. Branch is ready for CEO deploy approval.

---

## 2. Scope

| Surface | Status |
|---|---|
| F1 iOS LIFF fix (`?openExternalBrowser=1`) | ✅ Implemented |
| F2 Vacancy badge on /users | ✅ Implemented (badge logic fixed in audit) |
| F3 Inline side panel (`?selected=`) | ✅ Implemented |
| F4 Self-onboarding form (5 fields) | ✅ Implemented |
| F5 Auto-revoke old invite | ✅ Implemented (DB check fixed in audit) |
| F6 Settle gate | ✅ Implemented (TOCTOU-safe) |
| F7 Deactivation reason | ✅ Implemented |
| F8 LINE OA block | ✅ Implemented (error handling + audit log fixed) |
| F9 Graceful deactivated screen | ✅ Implemented |
| S1 Cover branch (Should-have) | 🟡 DB column only · no application code |

**OUT OF SCOPE:** HR approval workflow · payroll export · multi-branch permanent assignment (all confirmed absent in code — clean).

---

## 3. P0 Findings — FIXED IN THIS COMMIT

### P0-A · Invite revocation check inverted
**File:** `app/api/auth/line-login/route.ts` (line 304, now fixed)
**Finding:** Condition was `maid.inviteToken !== null && maid.inviteToken !== invite`. When F5 auto-revoke sets `inviteToken = null`, the check short-circuits to `false` — old HMAC-valid tokens could bind a LINE ID to an orphaned maid record.
**Fix applied:** Changed to `maid.inviteToken !== invite` — rejects when token is null (revoked) OR doesn't match (tampered/rotated).
**Confirmed by:** SEC · QA · SA (3-persona convergence = high confidence)

### P0-B · blockLineUser can throw, poisoning deactivateUser return value
**File:** `app/(admin)/chairops/users/actions.ts` (lines 480–490, now fixed)
**Finding:** `fetch()` inside `blockLineUser()` can throw on ECONNREFUSED/timeout. The deactivation `$transaction` already committed by this point, but the throw would propagate up, causing `deactivateUser` to return an error to the admin UI for a successful operation.
**Fix applied:** Wrapped in try/catch. Admin sees `{ok:true}` even if LINE block fails. Error written to audit log + console.
**Confirmed by:** SRE

### P0-C · Vacancy badge condition always false
**File:** `app/(admin)/chairops/(office)/users/page.tsx` (line 336, now fixed)
**Finding:** Condition was `u.isActive && !occupiedBranchIds.has(u.primaryBranchId)`. Since `occupiedBranchIds` is built from active maids, an active maid's branch is always in the set — making `!occupiedBranchIds.has(...)` always `false` for active maids. Inactive maids fail `u.isActive`. Badge never showed for anyone.
**Fix applied:** Removed `u.isActive &&` — badge now shows for any MAID row whose branch has no active coverage (most useful for inactive maids flagging vacant branches).
**Confirmed by:** FE (primary) · BA (analysis contradiction resolved)

---

## 4. P1 Findings — Fix Before Pilot

### P1-1 · LINE block failure not audit-logged
**File:** `app/(admin)/chairops/users/actions.ts:483`
**Finding:** On LINE block failure, only `console.error` was written. Spec §6 + §7 requires `line.block_failed` audit entry.
**Status:** ✅ Fixed in P0-B fix (writeAudit now called before console.error on block failure).

### P1-2 · F5 auto-revoke has no panel notification
**File:** `app/(admin)/chairops/(office)/users/invite/invite-form.tsx`
**Finding:** `createMaidInvite` revokes old invites silently — action return type `{link, userId}` carries no `revokedCount` flag. The invite panel gives admin no confirmation that a prior invite was cancelled.
**Recommendation:** Add `revokedCount: number` to the `createMaidInvite` return data and show a toast in the invite form when `revokedCount > 0`.
**CEO decision needed:** Yes — does the panel need to show this notification?

### P1-3 · mobilePhone validation under-constrained
**File:** `app/(admin)/chairops/users/actions.ts:733`
**Finding:** `z.string().trim().min(9)` accepts any 9+ character string including structurally invalid Thai phone numbers (e.g. `000000000`). Thai mobile = 10 digits starting `06x/08x/09x`.
**Recommendation:** `z.string().regex(/^0[6-9]\d{8}$/, "เบอร์มือถือต้องขึ้นต้นด้วย 06-09 ตามด้วย 8 ตัว")`.

### P1-4 · CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN not in env-validate REQUIRED_VARS
**File:** `lib/env-validate.ts`
**Finding:** If the token is missing from Vercel env vars, deactivated maids keep LINE OA access silently — no startup alert.
**Recommendation:** Add to REQUIRED_VARS if LINE block is considered required (not optional).
**CEO decision needed:** Is F8 optional (fail silently) or required (fail loud on boot)?

### P1-5 · createMaidInvite/createUser: deleteUser cleanup not guarded
**File:** `app/(admin)/chairops/users/actions.ts:164,723`
**Finding:** On Prisma transaction failure, `supabase.auth.admin.deleteUser(id)` is called without `.catch()`. If `deleteUser` fails, the orphaned auth user is left in `auth.users`.
**Recommendation:** Add `.catch((err) => console.error(...))` to both deleteUser rollback calls.

### P1-6 · ensurePoolMembership lacks transaction safety
**File:** `app/api/auth/line-login/route.ts:49–101`
**Finding:** Two sequential Prisma writes (`user.create` then `userModule.create`) without wrapping `$transaction`. If the second write fails, the first partially-created user row remains — maid's first login fails with 502. Self-heals on retry (second login attempt).
**Status:** ⚠️ Known fragility. Not breaking (retry heals it). Recommend wrapping in `$transaction` in a follow-up sprint.

### P1-7 · Magic link fetch() has no timeout
**File:** `app/api/auth/line-login/route.ts:445`
**Finding:** `await fetch(${supabaseUrl}/auth/v1/admin/generate_link, ...)` has no `AbortSignal.timeout()`. Slow Supabase auth will hold the LIFF open until Vercel function timeout.
**Recommendation:** Add `signal: AbortSignal.timeout(8000)` to the fetch options.

### P1-8 · (maid-public) architectural fragility
**File:** `app/(admin)/chairops/(maid-public)/`
**Finding:** Route group has no `layout.tsx` — deactivated/onboarding pages fall through to `app/(admin)/chairops/layout.tsx` which checks Pool module entitlement. Currently safe because `deactivateUser` does NOT revoke `user_modules.isActive`. If future offboarding adds module revocation, `/m/deactivated` becomes unreachable for truly-revoked users.
**Recommendation:** Document this dependency explicitly, or add a `layout.tsx` in `(maid-public)` that only calls `poolRequireSession()` (not module entitlement check).

---

## 5. P2 Findings — Polish / Later

| # | Finding | File | Recommendation |
|---|---|---|---|
| P2-1 | Spec §5 uses `FIRED`; code uses `TERMINATED` | `schema.prisma`, `user-detail-form.tsx` | Update workshop spec §5 to use `TERMINATED` (code is correct) |
| P2-2 | F9 phone number hardcoded `+66020000000` (placeholder) | `deactivated/page.tsx:29` | Replace with real office number or config env var |
| P2-3 | F7 deactivate: spec mentioned admin must type maid name as safety | `user-detail-form.tsx` | Add name-confirmation step if CEO considers it necessary |
| P2-4 | `getMaidUserRaw` export name doesn't warn against misuse | `lib/chairops/auth/session.ts:156` | Rename or add `// LAYOUT-ONLY` jsdoc comment |
| P2-5 | `inviteExpiresAt` DB field fetched but not DB-validated (HMAC covers it) | `line-login/route.ts:295` | Add comment clarifying HMAC is the primary expiry enforcer; DB field is display-only |
| P2-6 | EmptyPanel uses `👤` emoji | `user-side-panel.tsx:108` | Replace with Lucide `UserCircle` icon per CEO design preference |

---

## 6. Architecture Decisions Confirmed

- ✅ **F6 TOCTOU-safe**: settle check + deactivation in same `$transaction` — throws named `SETTLE_REQUIRED` error to distinguish from DB errors
- ✅ **F5 dual-validation**: HMAC (forgery prevention) + DB presence (revocation) — orthogonal purposes, both necessary
- ✅ **`getMaidUserRaw()` scope**: used in exactly 2 places (maid layout + onboarding page), both gated by `poolRequireSession()` first
- ✅ **`(maid-public)` route group**: cleanly resolves to `/chairops/m/onboarding` + `/chairops/m/deactivated` without URL conflicts
- ✅ **`deactivatedById` bare String?** (no FK): correct — preserves historical actor ID even if actor is later deactivated themselves
- ✅ **Invite expiry**: HMAC embeds `e` field (creation timestamp + 14-day TTL) verified at `lib/chairops/line/invite.ts:56`. DB `inviteExpiresAt` is redundant for security, used for display only
- ✅ **backfill `onboarding_complete = TRUE` for existing bound maids**: correct — prevents existing maids from being locked out post-migration
- ✅ **S1 `secondaryBranchId`**: DB column only, zero application code writes to it — correctly parked for future sprint

---

## 7. Acceptance Criteria Verification

| Feature | Spec AC | Verified |
|---|---|---|
| F1 | iPhone gd link → Safari (not WKWebView) | ✅ `?openExternalBrowser=1` in invite link |
| F2 | Vacancy badge per branch visible in /users | ✅ Sidebar: always shows · Table row: fixed (P0-C) |
| F3 | Invite/manage without page navigation | ✅ `?selected=` URL state → panel |
| F4 | 5 fields shown once after invite accept | ✅ `onboardingComplete` gate in layout + form |
| F5 | Old invite revoked when new one created for same branch | ✅ `updateMany` in transaction |
| F6 | Deactivate blocked if pending collections | ✅ `count(depositId=null)` in `$transaction` |
| F7 | Reason dropdown + note saved | ✅ `offboardingReason` + `offboardingNote` in DB |
| F8 | LINE block after deactivate, best-effort | ✅ `blockLineUser()` after tx, try/catch fixed |
| F9 | Deactivated maid sees graceful screen | ✅ `(maid-public)` route + maid layout redirect |

---

## 8. Persona Sign-Off Table (post-patch)

| Persona | Status | Notes |
|---|---|---|
| SEC | ✅ PASS | P0-A fix applied · x-line-internal concern is P1 (CEO decision) |
| BA | ✅ PASS | P0-C badge fix applied · P1-2 revoke notify is CEO decision |
| SA | ✅ PASS | `secondaryBranchId` FK gap is S1 placeholder only |
| QA | ✅ PASS | P0-A + P0-B fixes applied |
| DEVIL | ✅ PASS | No scope violations found |
| SRE | ✅ PASS | P0-B exception handling fixed · P1-4 is CEO decision |
| FE | ✅ PASS | P0-C badge fix applied |

---

## 9. Open Questions (CEO)

| # | Question | Feature | Priority |
|---|---|---|---|
| Q1 | LINE OA มี Messaging API + `blockMember` permission ไหม? | F8 | Before deploy |
| Q2 | F9 phone number — ใช้เบอร์จริงอะไร? หรือให้ admin configure? | F9 | Before deploy |
| Q3 | F8 LINE block failure: should log REQUIRED_VARS (fail on boot if token missing) or remain optional (silent degrade)? | F8/SRE | Before deploy |
| Q4 | F5 revoke notification: แจ้งใน panel ว่า "ยกเลิก invite เก่าแล้ว" หรือ silent OK? | F5 | Nice-to-have v1 |
| Q5 | F7 name-confirmation: admin ต้องพิมพ์ชื่อแม่บ้านก่อน confirm ไหม? | F7 | Nice-to-have v1 |

---

## 10. Deployment Checklist

```
ก่อน deploy:
☐ CEO อนุมัติ merge: claude/chairops-maid-management-9features → setup
☐ Apply migration: psql $DATABASE_URL < prisma/migrations/20260605_chairops_maid_management.sql
☐ ตรวจ LINE Developer Console: CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN (F8)
☐ อัปเดต F9 phone number: deactivated/page.tsx:29

หลัง deploy:
☐ ทดสอบ iPhone จริง 2 เครื่อง: กดลิงก์เชิญ → Safari เปิด → onboarding form
☐ ทดสอบ deactivate maid: settle gate + reason dropdown + LINE block
☐ ตรวจ badge ใน /chairops/users (filter แม่บ้าน): sidebar ว่าง badge ปรากฏ
```

---

## 11. Pilot Plan

**Day-1 Hotfix Budget:** 0.5 dev-day reserved for Day-1 bug discovery
**Critical path:** F1 (iOS fix) → F4 (onboarding) → F2/F3 (vacancy + panel) → F6-F9 (offboarding)
**Smoke test:** filter /users by แม่บ้าน role + verify vacancy badge + invite a test maid via LINE + complete onboarding

---

*Generated by `/auditbigteam` Reverse Audit · 7 personas · 2026-06-05*
*Fixes applied: P0-A (invocation check), P0-B (blockLineUser exception + audit log), P0-C (vacancy badge)*
