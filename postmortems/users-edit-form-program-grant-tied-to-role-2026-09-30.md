# `/users/[id]/edit`: program-access grant unreachable without also flipping the user's base role

**Summary.** The "แก้ไขผู้ใช้" edit form only rendered the "โปรแกรมที่เข้าถึงได้" checklist when the user's base org role was exactly `program_admin`. To grant an existing `branch_manager` or `staff` user access to one more program, an admin had to first flip their base role to `program_admin` — which simultaneously hid the branch picker (only shown for `branch_manager`/`staff`), silently dropping that person's branch scoping in the same save. The backend (`PUT /api/admin/users/[id]/modules`) never had this restriction; it was purely a UI-gating bug. Fixed by decoupling the program checklist from the role field (`app/(admin)/users/[id]/edit/edit-form.tsx`, commit `307bea46`), deployed and re-verified live.

## Symptom

CEO described wanting to grant an existing program admin (invited into Recruit) access to a second program later, without disturbing anything else about their account. Tracing the actual edit form for any non-`program_admin` role (e.g. a real `branch_manager` in production, "ผู้จัดการโรงแรม") showed no way to add a program grant at all — the "โปรแกรมที่เข้าถึงได้" section simply didn't render. The only path to grant a program was to change the person's role to `program_admin` first, which made the "สาขาที่ดูแล" section disappear in the same render, since that section only showed for `branch_manager`/`staff`.

## Root cause

`app/(admin)/users/[id]/edit/edit-form.tsx`:

```
const showBranches = role === "branch_manager" || role === "staff";
const showPrograms = role === "program_admin";
```

Both the branch picker and the program checklist were gated on the *currently selected* base role, and the two conditions are mutually exclusive by construction (`branch_manager`/`staff` vs `program_admin`). Submitting the form only called `PUT /api/admin/users/[id]/modules` when `role === "program_admin"`, so even if a caller worked around the UI (e.g. via devtools), the save path itself was also tied to that one role value.

The server side was never the constraint. `PUT /api/admin/users/[id]/modules` (`app/api/admin/users/[id]/modules/route.ts`) accepts a `modules`/`adminModules` array for any target role — it only checks that the caller outranks the target (`canManageUser`) and that only `super_admin` can set `adminModules` (module-admin grants) or touch `costctrl`. Nothing in that route ever referenced the target's base role.

## Why it produced the symptom

The two picker sections were designed as if "which extra UI to show" should track "what this person fundamentally is" (a program admin needs the program picker, a branch role needs the branch picker) — but in practice, program access and branch scoping are independent, orthogonal grants that any role can hold simultaneously (a `branch_manager` who also needs read access to one program is a completely ordinary case). Tying the picker's visibility to the role radio button meant the two grants could never be edited together for anyone except the one role, `program_admin`, that doesn't use branches at all.

## Fix

`app/(admin)/users/[id]/edit/edit-form.tsx` (`307bea46`):

- `showPrograms` changed from `role === "program_admin"` to `!["super_admin", "org_admin", "admin"].includes(role)` — every non-admin-tier role (`program_admin`, `branch_manager`, `staff`, `driver`, `viewer`) now renders the program checklist. Admin-tier roles stay excluded because they already see every module unconditionally (`userIsModuleAdmin`/`userHasModuleAccess` bypass the grant check for them), so a grant would be a no-op.
- The submit handler's guard changed from `if (role === "program_admin")` to `if (showPrograms)`, so the modules PUT now fires for every role the section is visible for, not just `program_admin`.
- `showBranches` was left untouched (`branch_manager`/`staff` only) — since program access no longer requires switching the base role, a `branch_manager` keeps their branch picker while also getting the program checklist in the same view.
- A second, adjacent bug was closed in the same pass: when a new program was ticked, the UI defaulted the "แอดมิน/สมาชิก" toggle to "แอดมิน" (module-admin) regardless of caller. For a caller who isn't `super_admin`, the API silently rejects `adminModules` (`error: "การแต่งตั้งแอดมินโปรแกรม สงวนสำหรับผู้ดูแลระบบ (super admin) เท่านั้น"`) — so a non-super_admin editor could fill the form, click save, and hit a rejection with no visible cause until the toast fired. Fixed by defaulting new grants to "สมาชิก" unless the caller is `super_admin`, and hiding the แอดมิน/สมาชิก toggle buttons entirely for non-`super_admin` callers (showing a static "สมาชิก — ให้เป็นแอดมินโปรแกรมได้เฉพาะ super_admin" label instead), so the UI can't offer an action the server will refuse.

No backend changes were needed — `PUT /api/admin/users/[id]/modules` already handled every role correctly.

## How it was found

Traced directly from the CEO's own example in a broader "redesign the invite/permissions UX" request ("ผมเชิญคนนึงเป็นแอดมินโปรแกรมรับสมัครงานไปแล้ว อนาคตอยากให้เป็นอย่างอื่นเพิ่ม"). Reading `edit-form.tsx` and `page.tsx` together showed the mutually-exclusive `showBranches`/`showPrograms` gate immediately; reading `app/api/admin/users/[id]/modules/route.ts` confirmed the backend imposed no equivalent restriction, isolating this as a pure UI-gating bug rather than an intentional server-side rule.

## Why it slipped through

The bug requires a specific combination to notice: editing a *non*-`program_admin` user (the common case) while *also* wanting to add a program grant (a less common but entirely legitimate need — e.g. promoting scope incrementally rather than re-inviting someone from scratch). Most edits either don't touch programs at all, or are done at invite time when the role picker and program picker are filled in together in one pass, which never exposes the "add a program later without losing existing branch scoping" gap. `tsc`/`eslint`/`next build` cannot catch this class of bug — it's a UI-visibility/UX-logic bug, not a type or compile error.

## Validation

- `tsc --noEmit`: 0 errors.
- `next build`: full production build passed, `/users/[id]/edit` present in the route table.
- Real click-through (not just static screenshot): logged in headless as the sanctioned test admin account, opened `/users/[id]/edit` for a real production `branch_manager` user ("ผู้จัดการโรงแรม"), confirmed both "โปรแกรมที่เข้าถึงได้" and "สาขาที่ดูแล" render together for the first time. Did not click "บันทึกการแก้ไข" against this real employee's record — view-only, since this is an existing person's live data, not a synthetic test row.
- Deployed to `origin/setup` (`307bea46`), confirmed the Vercel production deployment reached `● Ready`.

## Action items / follow-ups

- None structurally — the fix reuses the existing `user_modules` grant mechanism and existing API route as-is; no new tooling needed.
- Worth noting for any future per-user settings form with more than one independent grant type (role, branch, module, etc.): each grant's visibility/editability should be gated on "does this grant make sense for this entity," not on the value of an unrelated field, or the same class of "can't edit A without losing B" bug will recur.
