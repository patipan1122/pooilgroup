# BIGFEATURE · ChairOps Maid Multi-Branch — SPEC (locked 2026-07-08)

> Decisions: หลายสาขาถาวร (many-to-many via `ChairopsMaidAssignment`) · มือถือสลับทีละสาขา (cookie).
> Reviewed by 3 personas (DB architect · security adversary · QA/UX). All 🔴 findings folded in below.

## The keystone (security)

Maid isolation used to rest on `primaryBranchId` — a trusted, DB-only field the maid can't influence. Multi-branch makes the "active branch" cookie-influenced. **The entire security burden collapses onto 3 guards + 1 shared helper:**

1. **ONE shared branch-set resolver** (`lib/chairops/auth/branch-scope.ts`) used by BOTH the read path (`resolveActiveBranchId`) and `canSeeBranch`, with identical no-assignment fallback → "switchable set" == "viewable set", always.
2. `resolveActiveBranchId` MUST compute `activeBranchId = branchIds.includes(cookie) ? cookie : homeBranchId` — **intersection, never `cookie ?? home`**.
3. `canSeeBranch` becomes **async** using the FULL `getMaidBranchIds(actor)` set; **every one of its 8 call sites must be `await`ed** (un-awaited async = truthy Promise = always-true = total bypass — #1 footgun).
4. `setActiveBranch(branchId)` server action MUST re-validate `branchId ∈ getMaidBranchIds(actor)` server-side (not just org).

Because every maid write path already reads `session.user.primaryBranchId`, we **overload it in `getSession` to = activeBranchId** (spread copy, never a DB write). Verified: no maid path writes `session.user.primaryBranchId` back to a column. Result: all ~12 maid pages + all write actions auto-scope to the active branch through the single overloaded value.

## Phase 1 — Migration (`prisma/migrations/manual/20260708_chairops_maid_multibranch.sql`)

Self-healing, idempotent, one transaction, ordered: **1a de-dup active `(userId,branchId)` (tiebreak `startedAt,id`) → 1b backfill home assignment → 1c drop old 1-active partial-unique (auto-detect by def) → 1d assert no dup remains → 1e create `UNIQUE(userId,branchId) WHERE isActive AND endedAt IS NULL`.** Touches no cash data.

## Phase 2 — Backend scope + auth

- NEW `lib/chairops/auth/branch-scope.ts`: `getMaidBranches(userId)` [cache] → active assignments `{id,name}`; `getMaidBranchIds(actor)` (fallback `[primaryBranchId]` when zero rows); `resolveActiveBranchId({cookie,home,branchIds})` (intersection); `canSeeBranch(actor,branchId)` **async** (MANAGER+/OFFICE true; MAID → set-includes); `ACTIVE_BRANCH_COOKIE`.
- `session.ts`: `Session` gains `branchIds: string[]` + `homeBranchId: string|null`. `getSession` for MAID computes branchIds + activeBranchId (reads `await cookies()`), returns `user` spread with `primaryBranchId = activeBranchId`. Both return points include the new fields. Remove sync `canSeeBranch` from `role-guards.ts`; move to branch-scope; update 8 call sites to `await`.
- Layout badge (`(maid)/layout.tsx`): count pending for the **active** branch (via getSession), not `getMaidUserRaw().primaryBranchId`.
- Cron `sop-check` + `exec-home`: resolve maid→branch from active `ChairopsMaidAssignment`, not `primaryBranchId` (S1) — so multi-branch maids don't get false SOP alerts.

## Phase 3 — Admin add/remove branch (desktop maid detail)

- NEW actions (`maids/actions.ts`): `addMaidBranch(userId,branchId)` (idempotent via new unique + P2002 catch), `removeMaidBranch(userId,branchId)` (**block if home** → "ตั้งสาขาหลักใหม่ก่อน"; **block if pending un-deposited cash at that branch** → red warning), `setHomeBranch(userId,branchId)` (require ∈ active set). All ADMIN + `canManageUser` guarded + audited.
- Replace `ReassignBranchForm` (single dropdown) with `MultiBranchManager` — chips of assigned branches (home ⭐, others removable), add-branch dropdown, "ตั้งเป็นสาขาหลัก" per non-home chip.
- Retire dead `secondaryBranchId` path: remove `SecondaryBranchPicker` from user-side-panel + `m/profile` secondary display (column left dormant, no migration).
- Roster: show "N สาขา" badge per maid.

## Phase 4 — Maid mobile switcher

- `setActiveBranch(branchId)` server action (`(maid)/actions.ts`): validate ∈ branchIds → set cookie `ACTIVE_BRANCH_COOKIE` (path `/chairops`, httpOnly, sameSite lax, maxAge ~12h so it resets toward home next day) → revalidate.
- `MaidShell` header: show active branch "สาขา B ▾" (sticky, every page). Switcher = bottom-sheet listing branches **with per-branch pending ฿** ; **hidden if ≤1 branch** (90% case unchanged).
- Maid home (`m/page.tsx`): cross-branch reminder — "ยังมีเงินค้างฝากที่สาขาอื่น (B: ฿X)" summing pending across ALL her branches except active. Cut-off banner counts all branches.
- Confirm screens (collect/deposit): show "📍 กำลังบันทึกที่ สาขา B" before submit.

## Consistency checklist ✓
- [x] Reuse `ChairopsMaidAssignment` (no new table)
- [x] Every mutation audited (`writeAudit`)
- [x] Role-rank guard on all user-management actions ([[role-rank-privilege-escalation-guard]])
- [x] Mobile-first (Android Go, 44pt targets, bottom-sheet)
- [x] No ClawFleet touch ([[chairops-vs-clawfleet-separate]])
- [x] No AI, no CSV-write changes (import matcher reviewed for S2)

## Risks (ranked)
1. Money misattribution if read/write use different active-branch value → mitigated by single overloaded `primaryBranchId`.
2. Un-awaited async `canSeeBranch` → total bypass → audited every call site.
3. Orphan cash on branch removal → blocked by pending-cash guard.
4. Cookie tamper → intersection + setActiveBranch server validation.

## Acceptance (manual)
Assign 2nd branch → maid sees switcher → collect at A ฿1000 → switch to B → home/badge show B (A's ฿1000 not shown) → collect at B ฿500 → admin sees ฿1000@A, ฿500@B → home warns "ค้างที่ A ฿1000" → admin remove A while pending → blocked red.
