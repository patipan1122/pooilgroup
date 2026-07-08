# BIGFEATURE · ChairOps Maid Multi-Branch — CONTEXT (Phase 0)

> Feature: ให้แม่บ้าน 1 คนดูแล/ผูกได้หลายสาขาพร้อมกัน (หลายสาขาถาวร) · มือถือ (LINE) สลับทีละสาขา
> Repo: `legacy/pooilgroup-web` · Module: ChairOps · DB schema `chairops` (Prisma multiSchema)
> Decisions locked (CEO 2026-07-08): (1) หลายสาขาถาวร many-to-many · (2) มือถือ = สลับทีละสาขา (branch switcher, default = สาขาหลัก)

## Current data model (1 maid = 1 branch, DB-enforced)

- **`ChairopsUser`** (`prisma/schema.prisma:2854`)
  - `primaryBranchId String?` (L2869) — maid's home branch (required at create for MAID)
  - `secondaryBranchId String?` (L2892) — S1 "cover" field, **unused** downstream
  - `maidAssignments ChairopsMaidAssignment[]` (L2896)
- **`ChairopsMaidAssignment`** (`prisma/schema.prisma:2927`) — assignment/audit trail
  - `userId, branchId, startedAt, endedAt, isActive`
  - Indexes: `(branchId,isActive)`, `(userId,isActive)`
  - Schema comment (L2942): a **partial unique index `((userId) WHERE endedAt IS NULL AND isActive)`** is said to be enforced via the BF1 migration → enforces **1 active assignment per maid**. NOTE: not found in any `prisma/migrations/*` file → applied out-of-band in prod OR absent. Migration must handle both cases.
- **`ChairopsCashCollection` / `ChairopsCashDeposit`** carry `(branchId, maidId)` — money is attributed to a branch already, so history is safe.

## How the single branch is used today

- **Session**: `lib/chairops/auth/session.ts` `getSession()` (React `cache()`) → `{ authUser, user: ChairopsUser, poolUser }`. `requireExactRole("MAID")` wraps it.
- **Auth guard**: `lib/chairops/auth/role-guards.ts` `canSeeBranch(actor, branchId)` **sync** → MANAGER+/OFFICE = all; MAID = `actor.primaryBranchId === branchId`.
- **canSeeBranch callers** (5 files, ~8 sites): `m/collect/[id]/page.tsx:57`, `damage/actions.ts:167`, `damage/[ticketCode]/actions.ts` (×4), `api/chairops/r2/presign/route.ts:82`, `session.ts:141` (`requireBranch`).
- **Every maid page reads `session.user.primaryBranchId`** via `requireExactRole("MAID")`: `m/page.tsx`, `m/collect/new`, `m/deposit`, `m/cleanliness/new`, `m/damage(+/new)`, `m/parts(+/new)`, `m/collect/[id]`. → **This is the key: overload the session's active branch and every page follows.**
- **Maid layout** `app/(admin)/chairops/(maid)/layout.tsx` uses `getMaidUserRaw()` (raw DB) for the pending-deposit badge (L69) — bypasses getSession, must be updated separately.
- **Cron** `api/chairops/cron/sop-check/route.ts` filters `ChairopsUser.primaryBranchId IN branchIds` (home-only → may miss non-home branches under multi-branch).

## Admin assignment surfaces

- `createUser` (`users/actions.ts:49`) — MAID requires `primaryBranchId`; creates 1 active assignment (L127).
- `assignBranch` (`users/actions.ts:248`) — close-then-open + updates `primaryBranchId`; catches P2002.
- `reassignMaidBranch` (`maids/actions.ts:598`) — same close-then-open pattern; used by `ReassignBranchForm`.
- `assignSecondaryBranch` (`users/actions.ts:1123`) — the dormant "cover" path.
- Maid detail page `maids/[userId]/page.tsx` — single-dropdown `ReassignBranchForm` ("ย้ายสาขา · ปิด assignment เก่า"), + assignment history list.

## ensure-user note (don't break maid login)

`lib/chairops/auth/ensure-user.ts` — native maids have NO Pool grant; `ensureChairopsUser` returns their existing active row unchanged. Session overload must be applied to whatever `user` is returned (both getSession return points).

## Reuse / conventions to respect

- `ChairopsMaidAssignment` already exists → **reuse as the many-to-many source of truth** (no new table).
- React `cache()` on per-request lookups · audit every mutation via `writeAudit`.
- Namespaced env not relevant here (no new secrets).
- Memory: `[[chairops-vs-clawfleet-separate]]` (don't touch ClawFleet), `[[role-rank-privilege-escalation-guard]]` (guard user-management actions), `[[chairops-reconcile-tabs-fraud-check-semantics]]` (normalizeStoreKey collisions — not touched here).
