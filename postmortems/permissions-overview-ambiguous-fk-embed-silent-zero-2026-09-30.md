# `/users/permissions`: ambiguous `user_modules → users` embed silently zeroed every program's member/admin list

**Summary.** `app/(admin)/users/permissions/page.tsx` (the org-wide "สิทธิ์แต่ละโปรแกรม" overview, shipped earlier the same day as this fix, commit `2873e0c6`) queries `user_modules` with an implicit `users(name, role, is_active)` embed to show who has access to each of the 16 programs. `user_modules` has **two** foreign keys into `users` — `user_id` and `granted_by` — so PostgREST cannot resolve the embed and returns error `PGRST201` ("Could not embed because more than one relationship was found"). The query destructured only `{ data: grants }` without checking `error`, so `grants` silently became `null`, `byModule` stayed empty, and the page rendered "ยังไม่มีใครได้รับสิทธิ์แยก" (nobody has been granted separate access) for **every single program**, regardless of how many real grants existed. Fixed by adding the explicit FK hint `users!user_modules_user_id_fkey(...)` (`app/(admin)/users/permissions/page.tsx:62-70`). The same bug was independently caught and fixed in a second, new query built the same day (`app/(admin)/docuflow/settings/users/page.tsx`) before it ever shipped.

## Symptom

While building a new DocuFlow-specific users-and-permissions page, I ran the exact same query shape (`user_modules` joined to `users` via an implicit embed) against the real database and got zero rows back for a module (`docuflow`) that I could independently confirm had multiple active grants (via a raw, un-embedded `user_modules` select). Tracing it to the org-wide overview page showed the identical query shape there too — meaning that page, despite being described as done and deployed the same morning, had been showing an empty/zero state for every program's admin and member lists since it shipped.

## Root cause

`app/(admin)/users/permissions/page.tsx:60-64` (before fix):

```ts
admin
  .from("user_modules")
  .select("user_id, module_name, role, users(name, role, is_active)")
  .eq("org_id", orgId)
  .eq("is_active", true),
```

`user_modules` has two foreign keys targeting `users(id)`:
- `user_modules_user_id_fkey` — `user_modules.user_id → users.id` (who the grant is for)
- `user_modules_granted_by_fkey` — `user_modules.granted_by → users.id` (who issued the grant)

PostgREST's embed resolution needs a single, unambiguous FK to know which column to join `users` through. With two candidates it refuses to guess and returns:

```
code: 'PGRST201'
message: "Could not embed because more than one relationship was found for 'user_modules' and 'users'"
hint: "Try changing 'users' to one of the following: 'users!user_modules_granted_by_fkey', 'users!user_modules_user_id_fkey'."
```

The call site never checked `error`:

```ts
const [{ data: grants }, ...] = await Promise.all([ admin.from("user_modules").select(...)... ]);
```

`data` on an errored Supabase/PostgREST response is `null`. `(grants ?? []) as unknown as GrantRow[]` downstream turned that `null` into an empty array with no signal that anything had gone wrong — no thrown exception, no error boundary, no log line. The page rendered successfully; it just rendered the wrong (empty) data.

## Why it produced the symptom

The bug is invisible in every fast, common verification path:
- `tsc`/`eslint`/`next build` — the query is fully type-correct Supabase-JS; the ambiguity is a runtime property of the live schema's foreign keys, not something the TypeScript types encode.
- A first click-through as an admin who is *also* org-wide admin-tier (super_admin/org_admin/admin) — the page has a separate, correct code path for that: it always shows every program via `MODULES`, with the (empty, because of this bug) per-program admin/member breakdown just reading `"ยังไม่มีใครได้รับสิทธิ์แยก"`. That copy is a **legitimate, expected string** for a program that genuinely has zero separate grants yet — so an empty-looking DocuFlow card (which, before today, likely had few or no `user_modules` rows at all) was not obviously wrong. The bug only becomes visually undeniable once a program has real grants that should show real names and doesn't.
- Two of `user_modules`'s foreign keys point at the same target table with a plausible, easily-overlooked reason to add the second one (`granted_by`, added for audit/attribution, unrelated to "who has access") — nothing about adding that column signals "this will silently break every existing implicit `users(...)` embed on this table."

## Fix

Both queries now pass an explicit relationship name so PostgREST has no ambiguity to resolve:

- `app/(admin)/users/permissions/page.tsx:62-70`:
  ```ts
  .select(
    "user_id, module_name, role, users!user_modules_user_id_fkey(name, role, is_active)",
  )
  ```
- `app/(admin)/docuflow/settings/users/page.tsx:148-155` (new page, same fix applied before ship):
  ```ts
  .select(
    "user_id, role, users!user_modules_user_id_fkey(id, name, email, role, is_active)",
  )
  ```

No schema change, no data migration — this is purely a query-shape fix. Verified the corrected query returns real rows (see Validation).

## How it was found

Not from a bug report — found as a byproduct of building an unrelated feature (`/docuflow/settings/users`). Building that page's own `user_modules → users` query returned nothing for a module known (from a separate, raw `user_modules` select) to have real active grants. Isolating the two queries side by side and running them directly against the database (bypassing the app) surfaced the `PGRST201` error explicitly — at which point I recognized the identical `users(...)` embed shape in the already-shipped `/users/permissions` page and reproduced the same error there.

## Why it slipped through

- Supabase-JS returns errors as data (`{ data, error }`), not thrown exceptions — a destructure that only takes `data` (`const [{ data: grants }, ...]`) compiles fine, runs fine, and produces a plausible-looking (empty) result with zero indication anything failed. There is no lint rule or type-level enforcement in this codebase that catches an unchecked Supabase `error` field.
- The empty state has legitimate, correctly-worded copy of its own ("ยังไม่มีใครได้รับสิทธิ์แยก"), so a quick visual check of an admin-tier user's view looks completely normal — the page doesn't look broken, it looks like a program nobody has been individually granted yet.
- This shipped and was verified the same morning via a live click-through as an org-wide admin — but the click-through checklist verified *navigation and layout* (does the page load, do the cards render, does the invite button work), not *whether the displayed counts matched the real database state* for a program with known existing grants. The specific class of bug — "the page renders successfully but the data is silently wrong" — is exactly what a navigation-focused click-through does not catch; it requires cross-checking a number on screen against an independent query of the same data.

## Validation

- `tsc --noEmit` (via `NODE_OPTIONS=--max-old-space-size=8192`, default heap OOMs on this project): 0 errors on both changed files.
- `eslint` on both changed files: clean.
- `next build`: full production build passed.
- Direct query reproduction: ran the exact pre-fix query shape against the live database via the service-role client outside the app — reproduced `PGRST201` deterministically. Ran the exact post-fix query shape — returned real rows (5 program_admin/member grants for `docuflow` alone, including names, correctly resolved through `user_id` and not `granted_by`).
- Real click-through (headless, local dev server, sanctioned test admin account `claude-test@pooilgroup.test`): after the fix, `/users/permissions` renders real admin/member names and counts for `docuflow` (previously showed the empty-state copy for the same data). Screenshot: `rank-block-error.png` (captured for a different purpose — a live rank-limit test) incidentally shows the corrected page displaying "4 แอดมินโปรแกรม: บิว, หมู3, ไฮ, …" instead of the empty state.

## Action items / follow-ups

- **This fix is only applied in a local worktree** (`/private/tmp/pg-wt-docuflow-users-permissions`, branch `claude/docuflow-users-permissions-2026-09-30`, committed but not pushed) as of this writing. The live production `/users/permissions` page (deployed from `origin/setup` commit `2873e0c6` onward) is still serving the broken, empty-data version until this branch (or at minimum, this one-line query fix) is deployed. This is a **live regression on a page shipped as done** — worth prioritizing ahead of the new DocuFlow page it was found alongside.
- Worth a repo-wide grep for other implicit `users(...)` (or any other table with more than one FK into the same target) embeds that might have the same silent-null failure mode — this postmortem only fixed the two call sites found by accident, not by a systematic search.
- Consider a thin wrapper around Supabase list/embed queries used for admin-facing counts that throws (or at least logs) on a non-null `error`, so a future ambiguous-embed regression fails loudly in dev instead of rendering a plausible-looking empty state.
