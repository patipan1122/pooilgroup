# Post-mortem · ChairOps schema shipped but never migrated to prod

**Ticket:** N/A (no JIRA · internal session)
**PRs:** repair `ff5ec0e` · originating ship `5e3a6d2` (2026-05-21) · Wave 0 + Wave 1 build `87e806a` (2026-05-25)
**Owner:** Claude Opus 4.7 (engineering session) · CEO patipan@jpsyncgroup.com (discovery)
**Window:** 4 days (commit `5e3a6d2` deployed 2026-05-21 → CEO discovered 2026-05-26 ~21:30 ICT → fix complete 22:15 ICT)

---

## 1. Summary

ChairOps shipped as Pool module 2026-05-21 (`5e3a6d2` · "chairops: full integration as Pool Command Center module") with schema declared in `prisma/schema.prisma` (16 models in `chairops` schema) and 14 admin routes, but the bootstrap DDL (`prisma/migrations/9999_chairops_bootstrap_ALL.sql`) was never applied to the Supabase production database. Every authenticated request to `/chairops/*` 500'd with Prisma `P2021 · table chairops.ChairopsUser does not exist`. Fix: apply bootstrap SQL via psql with two inline type repairs (`current_user_*` helpers returning `text` not `uuid`), apply audit-log immutability trigger, seed CEO `ChairopsUser` row (commit `ff5ec0e`). Module was non-functional for 4 days; CEO was the first user to attempt login post-deploy.

## 2. Symptom

CEO opens https://pooilgroup.vercel.app/chairops after logging in. Page renders blank / 500. Server log (inferred from later psql repro) emits:

```
PrismaClientKnownRequestError: 
Invalid `prisma.chairopsUser.findFirst()` invocation in
lib/chairops/auth/session.ts:68:46
The table `chairops.ChairopsUser` does not exist in the current database.
  code: 'P2021'
  meta: {
    modelName: 'ChairopsUser',
    driverAdapterError: DriverAdapterError: TableDoesNotExist
  }
```

curl pre-deploy smoke test (run 2026-05-25 from this session) showed all 8 ChairOps routes returning `307` — *unauthenticated* requests redirected to `/login` by Pool's auth middleware before ever hitting the chairops layout / page. Post-login render was never exercised.

## 3. Root cause

**Two-track schema deployment with no enforcement:**

ChairOps uses a multi-schema Prisma setup. Models are declared with `@@schema("chairops")` in `prisma/schema.prisma:2762-3138` (16 models). Prisma generates a TypeScript client (output: `lib/generated/prisma/`) into the application bundle on every `next build` — that's all `5e3a6d2` shipped. The actual Postgres DDL (`CREATE TABLE chairops."ChairopsUser" ...`) lives in `prisma/migrations/9999_chairops_bootstrap_ALL.sql` (804 lines · 16 CREATE TABLE statements + RLS policies + helper functions + seed data) and **only takes effect when someone explicitly runs `prisma migrate deploy` (or `psql -f`) against the target database.** The 2026-05-21 deploy did neither.

`vercel.json` has no `buildCommand` override that runs migrations. There is no `prebuild` script in `package.json` that runs `prisma migrate deploy`. The Pool repo convention is "human applies migrations out-of-band" (e.g. via Supabase SQL editor). Nobody applied chairops bootstrap.

Two inline bugs in the bootstrap SQL would have blocked it even if someone had tried:
- `chairops.current_user_id()` declared `RETURNS uuid` but `SELECT u.id FROM "ChairopsUser"` returns `text` (Prisma `String` columns are Postgres `text`, not `uuid`) — Postgres rejects with `return type mismatch in function declared to return uuid; Actual return type is text`.
- `chairops.current_user_branch()` same issue.
- These would cascade into RLS policies that compare `"branchId" = chairops.current_user_branch()` (`text = uuid` → no operator).
- Also: lines 8–10 of the SQL file contained `◇ injected env (22) from .env.local` and `Loaded Prisma config from prisma.config.ts` — stdout from dotenv/Prisma that had been pasted into the SQL file at some prior point and never noticed. psql rejected the file at line 13 with `syntax error at or near "◇"`.

## 4. Why it produced the symptom

Pool auth path is independent of chairops DDL:
1. CEO logs in via Pool's Supabase auth → `auth.users` row exists → Pool session minted.
2. Middleware: `requireSession()` (from `@/lib/auth/session`) — passes (Pool `public.users` table exists with CEO row, `role=super_admin`).
3. `app/(admin)/chairops/layout.tsx:26-30` calls `isAdminTier(session.user.role)` → returns `true` for super_admin → skips `userHasModuleAccess` check → falls through.
4. Page-level: any `/chairops/*` page calls `requireAuth()` → `getSession()` → `prisma.chairopsUser.findFirst({ where: { authUserId } })` at `lib/chairops/auth/session.ts:68`.
5. Prisma adapter (Postgres driver) executes `SELECT ... FROM chairops."ChairopsUser" WHERE ...`.
6. Postgres returns `42P01` (table does not exist).
7. Prisma adapter wraps as `P2021` and throws.
8. Next.js renders default error page (or 500 in production).

The error happens at step 5 — the FIRST DB call against the chairops schema in any post-auth render path. Pool's auth layer never touches chairops, so login succeeds. The first cross into chairops territory blows up.

## 5. Fix

Applied via psql against `DIRECT_URL` (Supabase prod) in three steps (commit `ff5ec0e`):

**Step 1 · Bootstrap DDL.** Strip dotenv noise (`sed -i '/^◇/d; /^Loaded Prisma config/d' prisma/migrations/9999_chairops_bootstrap_ALL.sql`). Change `chairops.current_user_id()` and `chairops.current_user_branch()` to `RETURNS text` matching Prisma column types. Run `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/9999_chairops_bootstrap_ALL.sql`. First pass: 16 tables + ~20 ALTER TABLE FK additions succeeded · errored at line 488 on the now-fixed function. Drop conflicting functions (`DROP FUNCTION ... CASCADE`) · re-apply lines 484–801 (RLS section). 34 RLS policies + 5 helper functions + seed data (30 branches · 57 chairs · 8 spare parts · 30 drift rows) applied successfully. Tail of file contains an incomplete `INSERT INTO chairops."ChairopsUser" (...)` (no VALUES clause) — left as-is; CEO is seeded via separate script below.

**Step 2 · Audit-log immutability trigger.** Run `psql -f prisma/migrations/20260525_chairops_audit_log_immutable/migration.sql`. Creates `chairops.audit_log_immutable()` function (raises exception on any call) + three triggers on `chairops."ChairopsAuditLog"` for BEFORE UPDATE/DELETE/TRUNCATE. Wave-0 Fix 5 from this session's prior audit (per `chairops-audit-2026-05-25` memory).

**Step 3 · Seed CEO.** New file `scripts/seed-chairops-admin.mjs` (129 LOC · idempotent · uses Prisma client via DIRECT_URL). Looks up Pool `users` by email, inserts `ChairopsUser` with `authUserId` linked, `role=ADMIN`, `isActive=true`. Writes `chairops.audit_log` row tagged `action='access.granted_seed_script'`. Run: `npx tsx scripts/seed-chairops-admin.mjs patipan@jpsyncgroup.com` → seeded `id=3c7e6d2f-c689-4077-8a54-147b1e35b659`.

**Why this addresses the root cause (not just the symptom):** the missing schema IS the root cause for the immediate breakage. A symptom-hiding fix would have been e.g. `try/catch` around `prisma.chairopsUser.findFirst` returning null silently — that would unblock /chairops/* render but leave ChairOps non-functional. This fix puts the actual tables in place and seeds the first admin so the system can run. Future users go through the proper `/chairops/users/pending` approval flow (W7) instead of auto-bootstrap, preserving the Wave-0 Fix 3 security goal that removed `session.ts` auto-promotion.

## 6. How it was found

CEO opened https://pooilgroup.vercel.app/chairops · saw "เข้าโปรแกรมไม่ได้" · reported it.

Debugging path:
1. **First hypothesis (wrong):** CEO doesn't have a `ChairopsUser` row — Wave-0 Fix 3 removed auto-bootstrap so first-touch users get denied. Wrote `scripts/seed-chairops-admin.mjs` to seed CEO.
2. **Repro that nailed it:** ran the seed script. Prisma threw `P2021 · table chairops.ChairopsUser does not exist`. The table isn't even *there*, never mind whether CEO has a row.
3. **Single experiment that confirmed scope:** `psql "$DIRECT_URL" -c "SELECT count(*) FROM pg_tables WHERE schemaname='chairops'"` → `0`. Schema is empty.
4. **Cross-check:** `prisma/migrations/9999_chairops_bootstrap_ALL.sql` exists (804 lines · 16 CREATE TABLE). No `prisma migrate deploy` step in `vercel.json` or `package.json`. Application code never ran DDL on startup.

Tools that mattered: `psql` direct connection, Prisma error code (`P2021` is unambiguous about "table missing"), grep on `vercel.json` for buildCommand.

Hypotheses tried and rejected:
- **"Migration file wasn't generated"** — rejected by `ls prisma/migrations/` showing `9999_chairops_bootstrap_ALL.sql` present.
- **"RLS blocking everything"** — rejected because tables don't exist for RLS to even attach to.
- **"Wrong DATABASE_URL"** — rejected by `psql "$DIRECT_URL" -c "select current_database()"` returning the same Supabase prod project that's deployed.

## 7. Why it slipped through

Five distinct failure modes stacked:

1. **No CI/CD migration step.** `vercel.json` has no `buildCommand` running `prisma migrate deploy`. Pool's convention has been "operator applies migrations via Supabase Studio" — works when humans remember, breaks when they don't.
2. **Pre-deploy smoke test only checked unauthenticated routes.** curl smoke (this session) hit all 8 routes, got 307 (auth redirect), interpreted as "routing OK". Post-login render — where the bug fires — was never executed.
3. **Audit Phase 0.5 Drift Audit checked the wrong drift surface.** The auditbigteam `Phase 0.5 Drift Audit` (which I made MANDATORY this session) compared *plan doc ↔ schema.prisma* and *plan doc ↔ routes*. It did NOT compare *schema.prisma ↔ actual prod DB*. The skill assumed `@@schema("chairops")` in `schema.prisma` implies the schema exists in prod. That assumption was load-bearing and wrong.
4. **Prior memory was stale.** `chairops-audit-2026-05-25` memory said "ChairOps live on prod since 2026-05-21". Code presence on prod was correct; DB schema presence was assumed without verification. Per `[[migration-repair-without-real-apply-trap]]` memory, this is exactly the trap — "code says X exists" ≠ "X actually exists at the target".
5. **Pre-existing bugs in the bootstrap SQL.** Even if someone had attempted `prisma migrate deploy` in the 4-day window, it would have failed at line 488 (function return-type mismatch). The bugs were latent because nobody ran the file.

CEO was the first authenticated user to hit `/chairops/*` post-deploy. No other path triggered the failure during the 4-day window.

This is **blameless**: every individual gap above is a defensible engineering choice in isolation (Vercel-managed deploys without DB write privileges; smoke tests behind auth being expensive; audits trusting in-repo declarations). The aggregate created a 4-day blind spot.

## 8. Validation

DB-side, validated:
- `SELECT count(*) FROM pg_tables WHERE schemaname='chairops'` → 16 (was 0).
- `SELECT count(*) FROM pg_policies WHERE schemaname='chairops'` → 34.
- `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='chairops'` → 5 (helper functions).
- Seed data: `SELECT count(*) FROM chairops."ChairopsBranch"` → 30 · `ChairopsChair` → 57 (robinson-kanchanaburi only) · `ChairopsSparePart` → 8 · `ChairopsDrift` → 30.
- Audit immutability trigger: `BEGIN; DELETE FROM chairops."ChairopsAuditLog" WHERE id = (SELECT id FROM chairops."ChairopsAuditLog" LIMIT 1); ROLLBACK;` → `ERROR: chairops."ChairopsAuditLog" is append-only — UPDATE/DELETE/TRUNCATE forbidden · CONTEXT: PL/pgSQL function chairops.audit_log_immutable() line 3 at RAISE`. Trigger fires correctly.
- CEO seed: `SELECT id, role, "isActive", "displayName" FROM chairops."ChairopsUser" WHERE email='patipan@jpsyncgroup.com'` → `3c7e6d2f-c689-4077-8a54-147b1e35b659 | ADMIN | t | patipan tantikul`.
- Seed script idempotency: re-run → "✓ Already seeded · role=ADMIN".

**Not yet validated (browser-side):** CEO has not yet logged in to https://pooilgroup.vercel.app/chairops and confirmed a page renders. The DB now contains everything the application needs, but no end-to-end render through `chairops/layout.tsx → page.tsx → getSession → prisma.chairopsUser.findFirst` has been observed succeeding. This is the next step CEO must perform to close out validation.

**Not retested:** RLS behaviour from a non-ADMIN role (e.g. MAID querying her own branch only). Only one role (ADMIN bypass-everything) was seeded; OFFICE/MANAGER/MAID/TECHNICIAN policies are in place but exercised only by trigger creation, not by query traffic.

## 9. Action items / follow-ups

- **B-011 regression entry added to bigsolvebug.** Entry: `schema-shipped-but-not-migrated` at `~/.claude/skills/bigsolvebug/regression-library.md`. Pattern: for every `@@schema("<x>")` in `prisma/schema.prisma`, verify `count(*) FROM pg_tables WHERE schemaname='<x>'` matches expected model count. Phase 6 of future `/bigsolvebug` runs auto-detects this bug class. Owner: Claude · committed in `ff5ec0e`.
- **Add Agent 3E (schema-vs-DB drift) to bigsolvebug Phase 3.** Proposed in `docs/SKILL_SHARPENING_2026-05-25.md` (this session). Sequential agent that runs the B-011 check before any auto-fix Phase 5. Owner: Claude (next bigsolvebug iteration).
- **Add deploy-pipeline migration step.** Two viable paths: (a) `vercel.json` adds `buildCommand: "prisma migrate deploy && next build"`; (b) GitHub Action runs `prisma migrate deploy` on push to main before Vercel auto-deploys. Path (a) is simpler; path (b) is safer (failure doesn't block app build). Owner: CEO decision · not addressed in this fix.
- **Fix latent type bugs in bootstrap SQL upstream.** The repaired `current_user_*` functions (now `RETURNS text`) are committed in `ff5ec0e`. If the SQL was generated by a script, the generator needs the same fix to avoid regeneration overwriting. Owner: needs check on where 9999_chairops_bootstrap_ALL.sql originated.
- **Audit other Pool modules for the same drift.** ChairOps was the case that surfaced this. ClawFleet (mentioned in `STATUS.md` รอบ 53), Playland, DocuFlow, Recruit — any module with its own `@@schema()` should be checked: `for schema in clawfleet playland docuflow recruit; do psql "$DIRECT_URL" -c "SELECT count(*) FROM pg_tables WHERE schemaname='$schema'"; done`. Owner: Claude next session (or sooner if CEO requests).
- **CEO browser smoke-test all 7 ChairOps routes.** Validation §8 caveat — DB state is correct but end-to-end render is unobserved. Owner: CEO · before declaring incident closed.

---

**Related memories:** [[chairops-audit-2026-05-25]] · [[migration-repair-without-real-apply-trap]] · [[pool-schema-drift-2026-05-21]] · [[chairops-is-pool-module-not-standalone]] · [[feedback-real-world-verification]] · [[vercel-deploy-verify-cwd-first]]
