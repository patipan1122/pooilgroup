# `inviteProgramStaff()`-invited staff could not access the program they were just invited to

**Summary.** The generic `inviteProgramStaff()` action (shipped earlier the same day, `961dd9c5`) mints an org-role `staff` user plus a `user_modules` member-grant for one program. But `requireExecutiveRole`/`isExecutiveRole` (`lib/auth/role-guards.ts`) hard-excludes `staff`/`driver` from its role list, and `isProgramAdminTier`/`requireProgramAdminTier` only ever checks org-wide role tier — neither consults the `user_modules` grant. Net effect: an invited staff member could not open a single page of the program they were invited to, and even a staff/branch_manager hand-picked as a module's admin (`user_modules.role='admin'`) could not use that program's write actions. Fixed by adding two new composed helpers to `lib/auth/module-access.ts` (`requireModuleView`/`userCanViewModule`, `requireModuleAdmin`/`userCanAdminModule`) that OR the existing role-tier check with the existing per-module grant helpers, and wiring DocuFlow's ~46 call sites to use them. `role-guards.ts` itself, and every other module, are untouched.

## Symptom

CEO-requested feature from earlier the same day: any program admin can invite a plain staff member into their own program via `inviteProgramStaff()`. Testing the DocuFlow instance of this flow found the invited user could not open a single DocuFlow page — bounced on every visit, view or write alike.

## Root cause

Two independent gates, both role-only, both blind to `user_modules`:

1. `EXECUTIVE_ROLES` (`lib/auth/role-guards.ts:18-31`) — the list backing `requireExecutiveRole()`/`isExecutiveRole()`, used by nearly every DocuFlow page as the "can I view this page" gate — excludes `staff` and `driver` entirely. `inviteProgramStaff()` always mints role `staff` (deliberately — see `lib/auth/program-invite.ts` comment: never a peer admin, to stay inside the 2026-06-15 admin-appointment lock). So an invited staff member's role never clears this check, module grant or not.
2. `isProgramAdminTier()`/`requireProgramAdminTier()` (`role-guards.ts:86,95`) — the "can I use this program's write actions" gate, used on ~30 DocuFlow pages/routes — only checks `PROGRAM_ADMIN_TIER_ROLES` (admin tier + `program_admin`). A `staff`/`branch_manager` hand-picked as one module's admin via `user_modules.role='admin'` is invisible to it.

Both functions predate any module-grant awareness — they were designed on the assumption that "which program can I even reach" (the module-entry gate, `assertModuleEnabled`/`userHasModuleAccess`) and "what can I do once inside" (these two) could stay separate, because historically every role that reached these checks already had the right org-wide tier. `inviteProgramStaff()` broke that assumption the moment it started minting `staff` users with per-module grants instead of per-module roles.

## Why it slipped through

The bug was flagged the same day it was introduced, in `app/(admin)/docuflow/settings/users/page.tsx`'s own header comment (written while building that page, before this task started) — the author noticed `requireExecutiveRole` excludes staff/driver and left a note rather than silently shipping broken UX, then flagged it for a dedicated fix rather than a rushed inline patch. `tsc`/`eslint`/`next build` cannot catch this class of bug at all — every call site is type-correct; the gap is a logical role-vs-grant mismatch, only visible by actually assuming the invited user's identity and clicking through.

## Fix

Added to `lib/auth/module-access.ts` (new section at the bottom of the file; no changes to `role-guards.ts` or any other module's code):

```ts
export async function userCanViewModule(user: DbUser, module: ModuleSlug): Promise<boolean> {
  if (isExecutiveRole(user.role)) return true; // existing tier — no extra query
  return userHasModuleAccess(user, module);    // any active grant substitutes
}
export async function requireModuleView(user: DbUser, module: ModuleSlug): Promise<void> {
  if (!(await userCanViewModule(user, module))) redirect("/403");
}

export async function userCanAdminModule(user: DbUser, module: ModuleSlug): Promise<boolean> {
  if (isProgramAdminTier(user.role)) return true; // existing tier — no extra query
  return userIsModuleAdmin(user, module);          // grant role='admin' substitutes
}
export async function requireModuleAdmin(user: DbUser, module: ModuleSlug): Promise<void> {
  if (!(await userCanAdminModule(user, module))) redirect("/403");
}
```

This reuses `userHasModuleAccess`/`userIsModuleAdmin` — both already existed and already implement exactly the needed grant semantics (`userIsModuleAdmin` in particular already special-cases `program_admin`-with-any-grant and the ClawFleet stricter-admin carve-out). The composition itself (`isAdminTier(role) || userIsModuleAdmin(user, module)`) is the same pattern already battle-tested ad-hoc at ~15 RentSpace/ChairOps/ClawHub call sites (see the "ALREADY-CORRECT-COMPOSED" entries in `lib/auth/role-gate-known-exceptions.ts`) — this just centralizes it as a named, reusable pair instead of leaving it copy-pasted per call site.

DocuFlow's ~46 call sites (every `page.tsx`/`route.ts` under `app/(admin)/docuflow` and `app/api/docuflow`) were mechanically swapped: sites that called `requireExecutiveRole`/`isExecutiveRole` now call `requireModuleView`/`userCanViewModule`; sites that called `requireProgramAdminTier`/`isProgramAdminTier` now call `requireModuleAdmin`/`userCanAdminModule`. `app/(admin)/docuflow/settings/users/page.tsx`'s own capability-matrix table (`canView`/`canManage` columns) was updated to match the fixed semantics and its warning banner rewritten from "this doesn't work yet" to a short usage note.

**Redirect target changed from the originals' default.** `requireExecutiveRole`/`requireProgramAdminTier` redirect to `/cashhub/my-branches`/`/cashhub/heatmap` on failure — safe for their original callers (CashHub pages, and DocuFlow users who happened to also hold a CashHub grant from the historical backfill). `inviteProgramStaff()`-created users have no such default CashHub grant, so that target is a guaranteed second bounce to `/403` for them. The new `requireModuleView`/`requireModuleAdmin` redirect straight to `/403` instead — found via real click-through (see Validation), not assumed; fixed before finishing this task, not left as a known issue.

## Scope decision — DocuFlow wired, 15 other programs not (yet)

`inviteProgramStaff()` is generic — any of the 16 programs has the identical latent gap the moment its own admin invites staff through it. This fix wires the mechanism generically (`userCanViewModule`/`userCanAdminModule` take a `module` parameter, usable by any module) but only WIRES it into DocuFlow's call sites this pass — the module that was actually found broken and could be fully tested end-to-end today. The other 15 programs' `requireExecutiveRole`/`isProgramAdminTier` call sites are untouched and keep their exact current (broken-for-invited-staff) behavior until someone does the same mechanical swap for that module. This was a deliberate minimal-blast-radius call, not an oversight — flagged explicitly in the handoff report rather than silently left as a gap.

## Validation

- `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`): 0 errors.
- `eslint` on all changed files: 0 new errors/warnings (7 pre-existing errors/39 pre-existing warnings confirmed present on `origin/setup` before this change too, via `git stash` + re-lint).
- `next build`: clean, full route table including every DocuFlow route.
- Real click-through (headless Playwright, `claude-test` super_admin test account, isolated worktree dev server on `localhost:3151` — NOT the live `pooilgroup.com` deploy, which still runs the unfixed code):
  - Clicked the real "เชิญพนักงาน" button on `/docuflow/settings/users`, creating a real pending `staff` user + `docuflow` member grant through the actual `inviteProgramStaff()` action.
  - Impersonated that user (real `/api/admin/users/[id]/impersonate` flow): `/docuflow`, `/docuflow/documents`, `/docuflow/calendar` all loaded (200, no bounce) — the core bug, confirmed fixed. `/docuflow/settings` (write-tier) correctly still bounced to `/403` (member grant, not yet promoted) — security boundary intact.
  - Promoted the same user to module-admin (`user_modules.role='admin'` for docuflow) — `/docuflow/settings` then loaded; `/docuflow` still loaded.
  - Unimpersonated `super_admin` access to ChairOps/Recruit/ClawFleet: unchanged (200 on all three).
  - Impersonated a REAL production `program_admin` user (not synthetic) holding admin grants on ChairOps/ClawFleet/Recruit — all three still loaded identically, read-only navigation only, no data submitted.
  - Created a second synthetic `staff` user with zero grants anywhere — bounced to `/403` on both `/docuflow` and `/clawfleet`, proving no widening.
  - All synthetic test users + `user_modules` rows deleted after verification; confirmed zero leftover rows via a follow-up read-only query.

## Action items / follow-ups

- The other 15 programs need the identical mechanical swap (`requireExecutiveRole`→`requireModuleView`, `isProgramAdminTier`→`userCanAdminModule`, etc.) before their own `inviteProgramStaff()` invites work end-to-end. Not done this pass — see Scope decision above. Low-risk, same pattern, per-module effort.
- Worth a repo-wide sweep at some point to confirm no OTHER shared gate (beyond these two) still assumes "reaching this check implies org-wide role tier" now that per-module grants can mint capability independent of role.
