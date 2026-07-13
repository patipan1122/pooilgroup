// ChairOps · maid multi-branch scope — the SINGLE source of truth for
// "which branches does this maid manage" and "which one is she working now".
// Used by BOTH the read path (resolveActiveBranchId → session overload) AND the
// auth guard (canSeeBranch), so the switchable set == the viewable set, always.
//
// SECURITY (CEO 2026-07-08 · reviewed by 3 personas · see
// docs/BIGFEATURE_chairops-maid-multibranch_SPEC.md):
//   - resolveActiveBranchId INTERSECTS cookie ∩ branchIds (never `cookie ?? home`).
//     The cookie is client-controlled; the intersection is the keystone that
//     stops a maid from acting on a branch she isn't assigned to.
//   - canSeeBranch is ASYNC over the FULL assigned set — every caller MUST await.
//     An un-awaited call returns a truthy Promise → always "true" → full bypass.
//   - getMaidBranchIds reads LIVE rows so branch removal takes effect next request.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { ChairopsUser } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { rankOf } from "./role-guards";

/** Cookie holding the maid's currently-selected branch (mobile switcher). */
export const ACTIVE_BRANCH_COOKIE = "chairops_active_branch";

/**
 * Every branch a maid actively manages, with names, ordered by assignment age.
 * LIVE per-request read (React cache) — branch removal takes effect next request.
 */
export const getMaidActiveBranches = cache(async function getMaidActiveBranches(
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await prisma.chairopsMaidAssignment.findMany({
    where: { userId, isActive: true, endedAt: null },
    orderBy: { startedAt: "asc" },
    select: { branchId: true, branch: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.branchId, name: r.branch.name }));
});

/**
 * The set of branch ids a maid may see/act on. Falls back to [primaryBranchId]
 * for a legacy maid whose assignment row is missing — kept IDENTICAL to the
 * resolveActiveBranchId fallback so "switchable" and "viewable" never diverge.
 */
export async function getMaidBranchIds(actor: ChairopsUser): Promise<string[]> {
  const branches = await getMaidActiveBranches(actor.id);
  const ids = branches.map((b) => b.id);
  if (ids.length === 0 && actor.primaryBranchId) return [actor.primaryBranchId];
  return ids;
}

/**
 * How long a maid's picked branch stays active before auto-reverting to home.
 * Was the cookie maxAge (12h) — kept identical so behaviour doesn't change: she
 * reverts to her home branch the next day (กันลืมว่าค้างอยู่สาขาไหนข้ามวัน).
 */
export const ACTIVE_BRANCH_TTL_MS = 60 * 60 * 12 * 1000;

/**
 * Which branch the maid is working in RIGHT NOW.
 *
 * Priority (all guarded by the intersection with her assigned set):
 *   1. DB `activeBranchId` — the source of truth. It survives the LINE in-app
 *      browser dropping the cookie, and it works across devices. Honoured only
 *      while still within the 12h TTL (daily reset to home).
 *   2. Cookie — a client fast-path for normal browsers (set alongside the DB write).
 *   3. Home branch (when still assigned); else the first assigned branch; else null.
 *
 * The cookie/DB are client-triggered, so each only wins if it is genuinely in her
 * assigned set (intersection) — the keystone that stops cross-branch money access.
 */
export function resolveActiveBranchId(opts: {
  dbActiveBranchId?: string | null;
  dbActiveSetAt?: Date | null;
  cookieBranchId: string | null;
  homeBranchId: string | null;
  branchIds: string[];
  now?: Date;
}): string | null {
  const { dbActiveBranchId, dbActiveSetAt, cookieBranchId, homeBranchId, branchIds } = opts;
  const now = opts.now ?? new Date();
  if (
    dbActiveBranchId &&
    branchIds.includes(dbActiveBranchId) &&
    dbActiveSetAt &&
    now.getTime() - dbActiveSetAt.getTime() < ACTIVE_BRANCH_TTL_MS
  ) {
    return dbActiveBranchId;
  }
  if (cookieBranchId && branchIds.includes(cookieBranchId)) return cookieBranchId;
  if (homeBranchId && branchIds.includes(homeBranchId)) return homeBranchId;
  return branchIds[0] ?? homeBranchId ?? null;
}

/**
 * Active (maidUserId, branchId) coverage pairs for the given branches — the
 * multi-branch replacement for "find maids whose primaryBranchId IN branchIds".
 * A maid covering several branches appears once per branch, so SOP-check leave
 * suppression works for EACH branch she covers (CEO 2026-07-08).
 * Not React-cached (arg is an array); call once per cron run.
 */
export async function getActiveMaidCoverage(
  branchIds: string[],
): Promise<Array<{ userId: string; branchId: string }>> {
  if (branchIds.length === 0) return [];
  const rows = await prisma.chairopsMaidAssignment.findMany({
    where: {
      isActive: true,
      endedAt: null,
      branchId: { in: branchIds },
      user: { role: "MAID", isActive: true },
    },
    select: { userId: true, branchId: true },
  });
  return rows.map((r) => ({ userId: r.userId, branchId: r.branchId }));
}

/**
 * Async branch-visibility guard. MANAGER+ and OFFICE see all branches (they
 * reconcile across branches). A MAID sees only the branches she is actively
 * assigned to (home + any added branches).
 *
 * ⚠️ ASYNC — every call site MUST `await`. An un-awaited call returns a truthy
 * Promise → always "true" → full bypass.
 */
export async function canSeeBranch(
  actor: ChairopsUser,
  branchId: string,
): Promise<boolean> {
  if (rankOf(actor.role) >= rankOf(ChairopsUserRole.MANAGER)) return true;
  if (actor.role === ChairopsUserRole.OFFICE) return true;
  const ids = await getMaidBranchIds(actor);
  return ids.includes(branchId);
}
