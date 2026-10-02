# Recruit's local role arrays excluded `staff` entirely — grant-holding invited staff bounced at every tier

**Summary.** Unlike every other module, Recruit gated access with its own local role arrays (`RECRUIT_ROLES` / `RECRUIT_WRITE_ROLES` / `RECRUIT_ADMIN_ROLES` in `lib/recruit/role-guard.ts`) that have **no fallback to a `user_modules` grant at all**. `inviteProgramStaff()` mints a plain org-role `staff` user plus a `user_modules` grant for one program — but `staff` is not a member of any of the three Recruit arrays, so a staff member holding an active `recruit` grant (member OR admin tier) was bounced to `/403`/`/home` on every Recruit page, at every tier (view/write/admin) — a strictly worse gap than the view-only-fixed modules from earlier the same day (DocuFlow, CashHub, etc.), where only the write/admin tier had the gap. Fixed by converting all five exported functions in `lib/recruit/role-guard.ts` from synchronous `(role: DbUser["role"])` signatures to async `(user: DbUser)` signatures that additively OR the existing role-array membership check with `userHasModuleAccess`/`userIsModuleAdmin` (`lib/auth/module-access.ts`), and converting all 80 call sites across `app/(admin)/recruit/**`, `app/api/recruit/**`, and `lib/recruit/**` to `await` them with the full `user` object instead of `user.role`.

## Symptom

Same root cause class fixed across several modules today (DocuFlow, CashHub, RentSpace, repairs/playland/cafeorder): `inviteProgramStaff()` mints a `staff`-tier user + a per-module grant, but a module's own access gate doesn't consult the grant. Recruit was flagged as the hardest case because its gate is three **local** role arrays with zero grant-awareness at any tier, not the shared `role-guards.ts` tiers (`EXECUTIVE_ROLES`/`PROGRAM_ADMIN_TIER_ROLES`) the other modules used — so the centralized `userCanViewModule`/`userCanAdminModule` helpers built for DocuFlow couldn't be dropped in directly (see Design decision below).

## Root cause

`lib/recruit/role-guard.ts` defined three arrays, none of which include `staff`:

```
RECRUIT_ROLES       = [super_admin, org_admin, admin, program_admin, area_manager, branch_manager, viewer]
RECRUIT_WRITE_ROLES = [super_admin, org_admin, admin, program_admin, area_manager, branch_manager]
RECRUIT_ADMIN_ROLES = [super_admin, org_admin, admin, program_admin]
```

Five functions built on these arrays (`requireRecruitAccess`, `requireRecruitWrite`, `requireRecruitAdmin`, `canRecruitWrite`, `canRecruitAdmin`) took a bare `role: DbUser["role"]` string and did a synchronous `.includes()` check — no DB query, no way to consult `user_modules`. Every one of the ~80 call sites across Recruit's pages, Server Actions, and API routes called these with `session.user.role`, so a `staff` user could never pass any of the three tiers regardless of grant.

This matches the DocuFlow root cause exactly (see `postmortems/staff-invite-grant-access-gate-2026-09-30.md`) — both are "this gate predates module-grant awareness" — but Recruit's gate wasn't even the shared `role-guards.ts` tiers DocuFlow's was, so it needed its own composition rather than a straight swap to `requireModuleView`/`requireModuleAdmin`.

## Design decision — why not reuse `userCanViewModule`/`userCanAdminModule` directly

`RECRUIT_ROLES` happens to have the same members as `EXECUTIVE_ROLES` and `RECRUIT_ADMIN_ROLES` happens to equal `PROGRAM_ADMIN_TIER_ROLES` — but `RECRUIT_WRITE_ROLES` does **not** equal `PROGRAM_ADMIN_TIER_ROLES`: it additionally includes `area_manager`/`branch_manager`, which `PROGRAM_ADMIN_TIER_ROLES` excludes. Reusing the centralized `userCanAdminModule` for Recruit's write tier would have silently narrowed write access for `area_manager`/`branch_manager` — a real behavior regression hiding behind an apparently-safe refactor. Composing against Recruit's own arrays instead keeps every existing role-tier member's behavior byte-for-byte identical and only adds the new OR'd grant fallback.

## Fix

`lib/recruit/role-guard.ts` — the three role arrays are untouched; five functions converted:

```ts
export async function canRecruitAccess(user: DbUser): Promise<boolean> {
  if (RECRUIT_ROLES.includes(user.role)) return true;
  return userHasModuleAccess(user, "recruit");       // any active grant (member or admin)
}
export async function canRecruitWrite(user: DbUser): Promise<boolean> {
  if (RECRUIT_WRITE_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "recruit");          // grant.role === 'admin' only
}
export async function canRecruitAdmin(user: DbUser): Promise<boolean> {
  if (RECRUIT_ADMIN_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "recruit");
}
// requireRecruitAccess/requireRecruitWrite/requireRecruitAdmin wrap the above with redirect("/home")/("/recruit") on failure — same targets as before.
```

`canRecruitAccess` is new (the original had no boolean view-tier helper, only the redirect-on-fail `requireRecruitAccess`); the other four function **names** are unchanged — only their signature (`role` string → `user: DbUser`) and return type (sync → `Promise`) changed, so every call site needed `await` added and `.role` dropped from the argument, not an import rename.

### Call sites (80 total, mechanical `await X(session.user)` conversion)

- Pages (`app/(admin)/recruit/**/page.tsx`, 25 files): `requireRecruitAccess`/`requireRecruitWrite`/`requireRecruitAdmin` at the top of each Server Component, plus `canRecruitWrite`/`canRecruitAdmin` hoisted into a `const` before JSX where they were previously inlined directly into a prop (`app/(admin)/recruit/layout.tsx:25-31`, `blacklist/page.tsx`, `postings/[id]/page.tsx`, `applications/[id]/page.tsx`, `onboarding/[id]/page.tsx`, `table/page.tsx`, `pipeline/page.tsx`, `postings/page.tsx`, `page.tsx`) since JSX attribute positions can't `await` inline.
- Server Actions (`lib/recruit/actions.ts`, `template-actions.ts`, `interview-actions.ts`, `message-actions.ts`, `erasure-actions.ts`, `referral-actions.ts`, `rule-actions.ts`, `app/(admin)/recruit/_actions/ai.ts`, `app/(admin)/recruit/onboarding/actions.ts`): `if (!canRecruitWrite(session.user.role))` → `if (!(await canRecruitWrite(session.user)))`. All were already `async function`s (every site already did `const session = await requireSession()` immediately above), so no function needed to become newly async.
- API routes (`app/api/recruit/cover-upload/route.ts`, `app/api/recruit/onboarding/documents/[docId]/route.ts`, `app/api/recruit/upload-question-image/route.ts`): same pattern inside the route handler.

No call site was in a tight loop or depended on the old sync-and-fast behavior (checked via grep for `.map`/`.filter`/`for` near every call site before converting) — each site calls the guard exactly once per request.

### What was deliberately left untouched

- `app/(admin)/recruit/settings/team-actions.ts` (`inviteRecruitTeammate`, the 2026-09-06 self-serve carve-out) — already calls `userIsModuleAdmin(session.user, "recruit")` directly and always mints a peer `program_admin` (never plain staff). Not touched; verified still correct (see Validation).
- `app/(admin)/recruit/layout.tsx:26-29` — a second, pre-existing module-entry gate (`if (!isAdminTier(role)) { const ok = await userHasModuleAccess(...); if (!ok) redirect("/403"); }`) that already required a `recruit` grant for every non-admin-tier role, including `branch_manager`/`area_manager`/`program_admin`/`viewer` who clear `RECRUIT_ROLES` by role alone. Removing it would have been a behavior change (those roles would stop needing an explicit grant) outside this task's scope — left exactly as-is; `requireRecruitAccess`'s new grant-fallback check now runs ahead of it and makes it redundant for `staff` specifically (two queries instead of one for that one role), but changes nothing observable.

## Validation

- `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`): 0 errors (after fixing an unrelated worktree `node_modules` copy gap — see Infra note below).
- `eslint` on all changed files: identical 8 pre-existing problems (6 errors/2 warnings, none on lines this change touched) confirmed present on `origin/setup` too via `git stash` + re-lint + `git stash pop`.
- `next build`: compiled successfully, full route table including every Recruit route. No `fonts.googleapis.com` sandbox-DNS issue hit this run.
- `npx tsx lib/auth/__tests__/role-gate-completeness.run.ts`: 229/247 — same 18 pre-existing RentSpace failures as the documented baseline, zero regression.
- Real regression testing — headless Playwright, `claude-test` super_admin test account, isolated worktree dev server on `localhost:3193` (not the live deploy, which still runs the unfixed code), `12/12` checks passed:
  - Real test-admin's `/docuflow` and `/cashhub` access: unchanged (200 on both).
  - Self-invite carve-out (`/recruit/settings/permissions` → "สร้างลิงก์เชิญ"): created user has `role=program_admin` and a `recruit` grant with `role=admin, is_active=true` — unaffected by this change.
  - Synthetic `staff` user, **zero** recruit grant: blocked on all three tiers (`/recruit/dashboard`, `/recruit/postings/new`, `/recruit/settings/pdpa` all landed on `/403`) — unchanged baseline.
  - Same user promoted to a `member` grant: view tier (`/recruit/dashboard`) now works; write/admin tiers still blocked (`/recruit/postings/new`, `/recruit/settings/pdpa` redirect to `/recruit`) — matches the "member grant = view only" spec.
  - Same user promoted to an `admin` grant: all three tiers now work — the full fix.
  - All synthetic users + `user_modules` rows deleted after verification; confirmed zero leftover rows via a follow-up query (one unrelated leftover row from a different session, `Impeccable QA (TEMP, role=admin)`, was left untouched as it predates and is outside this task).

### QA-methodology gotcha found during validation (worth flagging for future sessions)

The first regression pass used `page.goto(url, { waitUntil: "domcontentloaded" })` (the exact pattern a sibling module's QA script used successfully earlier today) and got a **false failure**: it reported zero-grant staff landing on the originally-requested URL with `status=200`, looking like the gate wasn't firing at all. Root cause: `requireRecruitAccess`'s `redirect("/home")` fires from a **nested layout** (`app/(admin)/recruit/layout.tsx`) partway through an already-streaming RSC response; Next.js can't rewrite the HTTP status code after bytes have started flushing, so it falls back to a **client-side** redirect embedded in the RSC payload that only executes once JS hydrates. `domcontentloaded` (and a raw `APIRequestContext.get()`, which never runs JS at all) observes the pre-hydration state and misreports both status and URL. Confirmed via a server-side `console.error` trace that the redirect genuinely fired every time; switching the test harness to `waitUntil: "networkidle"` + a short settle delay resolved it and produced the correct, differentiated pass/fail results above. Any future headless-Playwright access-gate test against a gate that lives in a **nested layout** (not the top-level page) should wait for network-idle, not just DOM-content-loaded.

### Infra note (unrelated to the bug, fixed in-place)

The isolated worktree's `node_modules` (hardlink-copied via the standard `cp -al` + `.* *` glob loop, across two separate invocations due to a sandbox timing quirk) ended up with an incomplete `@zxing` scoped-package directory: the first invocation's partial copy created `node_modules/@zxing/` with only `text-encoding` inside; the second invocation's shallow one-level `[ -e dest/$f ] && continue` skip logic saw `@zxing` already existed as a directory and skipped it entirely, never descending to fill in the missing `browser`/`library` sub-packages. This broke `tsc` with unrelated `Cannot find module '@zxing/browser'` errors. Fixed by a second, one-level-deeper copy pass scoped to `@zxing/*` specifically, after confirming (via an entry-count diff across every top-level `node_modules` directory, including all `@scope` dirs) that `@zxing` was the *only* affected package. Worth remembering: the existing "cp -al worktree node_modules" shortcut-check only guards against re-copying *files*; a *partially-copied scoped package directory* silently short-circuits as "already exists" and never gets completed on a resumed/second pass.

## Action items / follow-ups

- None outstanding for Recruit itself — all three tiers (view/write/admin) now grant-aware, matching the "fixed" definition in the task spec exactly.
- The QA-methodology note above (wait for `networkidle`, not `domcontentloaded`, when testing a gate inside a nested layout) is worth carrying into any future access-gate regression script in this repo.
