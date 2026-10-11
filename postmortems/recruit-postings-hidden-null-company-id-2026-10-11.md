# Post-mortem: Recruit postings invisible after Phase 1 company-isolation change

**Summary.** `/recruit/postings` showed far fewer job postings than actually exist because `resolveCompanyFilter()` (`lib/auth/company-context.ts`) was changed by the Phase 1 branches commit to never return `undefined` anymore, which silently turned on company filtering for 4 recruit pages that were never the intended target. 32 of 52 real postings (62%) had `company_id = NULL` by original schema design and matched no company filter value at all, so they disappeared under every possible company selection. Fixed by backfilling `company_id` on those 32 rows (CEO-confirmed they all belong to JP Sync Group) rather than changing code. Commit `db70522f` on `setup` (pooilgroup-web), not yet pushed.

## Symptom

CEO reported (with screenshot) that `/recruit/postings` under the "ทั้งหมด" (all) tab showed only a handful of posting cards, fewer than expected. Confusion persisted even after re-selecting companies: "เลือกบริษัทดีๆ แล้วข้อมูลก็ยังหายไป" — the postings stayed hidden regardless of which company was selected in the header switcher, which ruled out a simple "wrong company selected" explanation.

## Root cause

`app/(admin)/recruit/postings/page.tsx:58` builds its Prisma query with:

```ts
...(companyId ? { companyId } : {}),
```

`companyId` comes from `resolveCompanyFilter()` (`app/(admin)/recruit/postings/page.tsx:124`, defined in `lib/auth/company-context.ts:38-51`). Before 2026-10-10, this helper could return `undefined` when the header company-switcher was set to "ทั้งหมด" (All), which skipped the `companyId` clause entirely and returned postings across every company.

Commit `5d2c3af2` ("fix(branches): company-switcher scoping Phase 1 — RLS backstop + remove 'all' view", 2026-10-10 22:45:33) changed `resolveCompanyFilter()`'s contract: it now always resolves to one concrete company (URL param → cookie → first company by code), and can never return `undefined`. The commit's own message notes 7 call sites were updated for the new signature, including 4 in recruit (`postings/page.tsx`, `page.tsx:51`, `pipeline/page.tsx:38`, `table/page.tsx:80`, `postings/new/page.tsx:37`). Those call sites compiled and type-checked fine against the new signature — the filter clause itself didn't need to change syntactically — but their *behavior* changed from "show everything" to "show only one company," which was never the goal for recruit; the commit's actual target was `/branches`.

Compounding this: `recruit_job_postings.company_id` is a nullable column by original design (`prisma/schema.prisma:1485`, inline comment `// optional · CEO said "use together"`). A live read-only query confirmed 52 total postings, all status OPEN: JP Sync Group = 19, Pooil Oil = 1, `company_id IS NULL` = 32 (62%). An exact-match Prisma filter `{ companyId: '<uuid>' }` never matches `NULL` rows in the underlying SQL (`WHERE company_id = '<uuid>'` excludes NULLs regardless of which uuid is used). So the 32 untagged postings were invisible under *every* company selection, not just the "wrong" one.

## Why it produced the symptom

The visible symptom — "postings missing no matter which company I pick" — maps directly to the NULL-vs-exact-match mechanics above: there is no company value that matches `NULL` in SQL, so no selection in the switcher could ever surface those 32 rows once the filter went from optional to mandatory. The CEO's confusion ("เลือกบริษัทดีๆ แล้วก็ยังหาย") was in fact the correct observation that something other than selection was wrong — the rows simply had no company to match against.

## Fix

Not a code change. CEO confirmed directly that all 32 untagged postings belong to JP Sync Group. Wrote `prisma/migrations/manual/20261011_recruit_backfill_jpsync_company.sql`:

```sql
UPDATE recruit_job_postings
SET company_id = '00000000-0000-0000-0000-0000000000a2' -- JP Sync Group
WHERE company_id IS NULL
  AND org_id = '00000000-0000-0000-0000-000000000001';
```

Scoped to `org_id` to avoid touching any row outside this org. Run via `./node_modules/.bin/prisma db execute --file <path>` per the project's established production-DB procedure (no `psql`, no manual Supabase dashboard edits). This addresses the root cause of the *data gap* (untagged rows) rather than reverting or special-casing `resolveCompanyFilter()`'s new contract, since the CEO wants recruit scoped by company like the rest of the company-isolation project — the rows just needed the tag they were always supposed to have.

Committed locally as `db70522f` on branch `setup` (not yet pushed to `origin/setup`, which auto-deploys — no app code changed, so a deploy isn't required for the fix to be live; the data is already corrected in production).

## How it was found

Started from the CEO's screenshot and a code-reading investigation (delegated to a sub-agent) that located the postings query, traced `companyId` back to `resolveCompanyFilter()`, and found `5d2c3af2` via `git log` on the relevant files/helper. The sub-agent then ran a read-only Supabase query (`execute_sql`) against `recruit_job_postings` grouped by `company_id` to get an actual count instead of guessing — this single query (19 / 1 / 32-null) confirmed both the mechanism (nullable column, exact-match filter) and the scale (62% of rows affected), and ruled out a status-filter or soft-delete explanation (all 52 rows are status OPEN; no soft-delete column exists on the table). No hypothesis was rejected along the way — the first trace (shared helper's contract change) was correct, and the DB query confirmed it immediately.

## Why it slipped through

Review/verification gap: the Phase 1 branches commit changed a shared helper's return contract and swept 7 call sites into the new behavior, including 4 in recruit that weren't the commit's target. The commit's own STATUS.md entry (2026-10-10) claimed recruit was checked and unaffected ("เช็ค 4 โปรแกรมที่เคยใช้ 'ทั้งหมด' ถูกอยู่แล้ว (cashhub/dashboard/recruit/ledger) ไม่ให้พัง"), but that claim was based on reading the code, not on an actual click-through of the recruit postings page after the change. The regression was invisible to type-checking and build because the filter clause's syntax was still valid Prisma — only its runtime selectivity changed, and only for rows with `NULL company_id`, which a developer reasoning abstractly about "will this still filter correctly" would not surface without querying real data.

## Validation

Read-only Supabase query after the migration ran: `recruit_job_postings` grouped by company for this org now returns JP Sync Group = 51, Pooil Oil = 1 (52 total, zero `NULL` remaining) — matches the pre-fix total exactly, confirming no rows were lost or duplicated. Captured a real production screenshot (mobile viewport, logged in, headless via `scratchpad/shot.mjs`) of `/recruit/postings` showing postings that were previously hidden (e.g. "กกหก", "รับสมัครแม่บ้านเก้าอี้นวด คอนโด เคนซิงตัน สุขุมวิท") now rendering under JP Sync Group.

Not independently re-verified: `recruit/page.tsx`, `pipeline/page.tsx`, and `table/page.tsx` call the same `resolveCompanyFilter()` and almost certainly had the identical symptom. The backfill should resolve them the same way the postings list was resolved (same underlying NULL rows, same filter mechanism), but each page has not been individually click-tested post-fix.

## Action items

- Click-test `recruit/page.tsx`, `pipeline/page.tsx`, `table/page.tsx`, and `postings/new/page.tsx` directly to confirm the same fix resolved them — no code change expected, verification only. (Owner: next session touching recruit, no ticket.)
- Audit the other 3 of the 7 `resolveCompanyFilter()` call sites from commit `5d2c3af2` (dashboard, cashhub, ledger per STATUS.md) for the same "claimed checked but not click-tested" gap — confirm with a live query/screenshot, not a re-read of the code. (Owner: next session touching company-isolation work, no ticket.)
- When future phases of the company-isolation project (`docuflow` → `clawfleet` → `repairs` → `playland`) touch a nullable `company_id`-style column, check for existing NULL rows and decide a backfill plan *before* flipping the filter to mandatory — this bug class (optional column + newly-mandatory exact-match filter = silent data loss on the NULL rows) will recur if not checked explicitly each time. (Owner: whoever runs the next phase, no ticket.)
- Recorded as feedback memory `feedback-shared-helper-signature-change-needs-click-test-all-callers-2026-10-11` so future sessions treat "STATUS.md says a caller was checked" as unverified until independently click-tested when a shared helper's contract changes.
