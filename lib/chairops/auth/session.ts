// ChairOps session wrapper — bridges Pool's auth into ChairOps's role model.
//
// Pool already authenticates users via Supabase auth.users (session.authUserId).
// ChairOps has its own ChairopsUser table keyed by authUserId for role/branch data.
//
// Strategy:
//   1) Reuse Pool's `requireSession()` (so Pool's login flow keeps working).
//   2) Look up a matching ChairopsUser row by authUserId.
//   3) Reconcile that row against the LIVE central Pool grant via
//      `ensureChairopsUser` — create it when missing, reactivate it when it was
//      deactivated but the central grant is active again, upgrade its role when
//      the user is now a program-admin. The grant IS the approval.
//
// Role mapping (Pool -> ChairOps):
//   super_admin / org_admin / admin -> ADMIN
//   area_manager / branch_manager   -> MANAGER
//   staff                           -> OFFICE
//   driver / viewer                 -> OFFICE
//
// Maids and Technicians do NOT have a Pool role — they live as ChairopsUser
// rows only. Their access goes through the same Pool login but auth-only.

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  requireSession as poolRequireSession,
  getSession as poolGetSession,
  type DbUser,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { ChairopsUser } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import {
  userHasModuleAccess,
  userIsModuleAdmin,
  isAdminTier,
} from "@/lib/auth/module-access";
import { ensureChairopsUser } from "./ensure-user";
import { rankOf } from "./role-guards";
import {
  getMaidActiveBranches,
  resolveActiveBranchId,
  ACTIVE_BRANCH_COOKIE,
} from "./branch-scope";

export interface Session {
  authUser: { id: string; email?: string | null };
  user: ChairopsUser;
  poolUser: DbUser;
  /**
   * MAID: every branch she actively manages (home + added). Empty for non-maids
   * (they see all branches via canSeeBranch). The security-authoritative set.
   */
  branchIds: string[];
  /** MAID: her home branch (true DB primaryBranchId) — default when no cookie. */
  homeBranchId: string | null;
}

function deriveChairopsRoleFromPool(poolRole: DbUser["role"]): ChairopsUserRole {
  switch (poolRole) {
    case "super_admin":
    case "org_admin":
    case "admin":
      return ChairopsUserRole.ADMIN;
    case "area_manager":
    case "branch_manager":
      return ChairopsUserRole.MANAGER;
    case "staff":
    case "driver":
    case "viewer":
    default:
      return ChairopsUserRole.OFFICE;
  }
}

// Returns the ChairopsUser bound to the Pool session, reconciling it against the
// LIVE central grant (create / reactivate / upgrade) so a program-admin who was
// granted chairops in the central UI can actually enter. Cached per-request via
// React `cache()`. The heavy lifting lives in `ensureChairopsUser`, shared with
// the central grant API so the lazy (on-access) and proactive (on-grant) paths
// stay in sync.
export const getSession = cache(async (): Promise<Session | null> => {
  const poolSession = await poolGetSession();
  if (!poolSession) return null;

  const poolDbUser = poolSession.user;
  const authUserId = poolSession.authUserId;
  const email = poolSession.email ?? poolDbUser.email ?? null;

  // Hot path: an already-active ADMIN row needs no reconciliation — return it
  // without the extra Pool-grant lookups (the common case for an admin who has
  // used ChairOps before).
  const existing = await prisma.chairopsUser.findFirst({ where: { authUserId } });
  if (existing?.isActive && existing.role === ChairopsUserRole.ADMIN) {
    // ADMIN is never a maid → no branch scoping needed (sees all).
    return {
      authUser: { id: authUserId, email },
      user: existing,
      poolUser: poolDbUser,
      branchIds: [],
      homeBranchId: existing.primaryBranchId ?? null,
    };
  }

  // Otherwise resolve the LIVE Pool authorisation and reconcile the row to match.
  // The grant IS the approval — an active chairops grant (or admin-tier) will
  // create / reactivate / upgrade the row. See ./ensure-user.ts and
  // [[program-admin-must-just-work-2026-06-15]].
  const poolIsAdmin = isAdminTier(poolDbUser.role);
  const grantedAdmin = poolIsAdmin || (await userIsModuleAdmin(poolDbUser, "chairops"));
  const grantedAny = poolIsAdmin || (await userHasModuleAccess(poolDbUser, "chairops"));

  // Kept alive for the future admin-approval flow that derives role from Pool tier.
  void deriveChairopsRoleFromPool;

  const user = await ensureChairopsUser({
    orgId: poolDbUser.org_id,
    authUserId,
    email,
    displayName: poolDbUser.name || email || "ผู้ดูแล",
    grantedAdmin,
    grantedAny,
    source: "getSession",
  });
  if (!user) return null;

  // Multi-branch (CEO 2026-07-08): for a MAID, resolve the set of branches she
  // manages + which one she is working in now (cookie ∩ set, default home), then
  // OVERLOAD user.primaryBranchId to that active branch so every maid page/action
  // — all of which read session.user.primaryBranchId — auto-scopes to it. This is
  // a spread copy; it is NEVER written back to the DB (verified: no maid path
  // persists session.user.primaryBranchId). Non-maids keep their row untouched.
  let branchIds: string[] = [];
  const homeBranchId = user.primaryBranchId ?? null;
  let effectiveUser = user;
  if (user.role === ChairopsUserRole.MAID) {
    const branches = await getMaidActiveBranches(user.id);
    branchIds = branches.map((b) => b.id);
    // legacy safety: keep home in the set even if its assignment row is missing
    if (homeBranchId && !branchIds.includes(homeBranchId)) branchIds.push(homeBranchId);
    const cookieBranchId = (await cookies()).get(ACTIVE_BRANCH_COOKIE)?.value ?? null;
    const activeBranchId = resolveActiveBranchId({
      dbActiveBranchId: user.activeBranchId,
      dbActiveSetAt: user.activeBranchSetAt,
      cookieBranchId,
      homeBranchId,
      branchIds,
    });
    effectiveUser = { ...user, primaryBranchId: activeBranchId };
  }

  return {
    authUser: { id: authUserId, email },
    user: effectiveUser,
    poolUser: poolDbUser,
    branchIds,
    homeBranchId,
  };
});

export async function requireAuth(): Promise<Session> {
  // Force Pool auth — if user not logged in at all, Pool redirects to /login
  await poolRequireSession();
  const session = await getSession();
  // User is Pool-authenticated but has no ChairopsUser row → access denied.
  // Audit log already written inside getSession() · just redirect.
  if (!session) redirect("/403?reason=chairops_access_pending");
  return session;
}

export async function requireRole(min: ChairopsUserRole): Promise<Session> {
  const session = await requireAuth();
  if (rankOf(session.user.role) < rankOf(min)) {
    redirect("/chairops?error=forbidden");
  }
  return session;
}

/** Exact-role check (no rank fallthrough) — e.g. MAID-only routes. */
export async function requireExactRole(role: ChairopsUserRole): Promise<Session> {
  const session = await requireAuth();
  if (session.user.role !== role) {
    redirect("/chairops?error=forbidden");
  }
  return session;
}

export async function requireBranch(branchId: string): Promise<Session> {
  const session = await requireAuth();
  const { canSeeBranch } = await import("./branch-scope");
  if (!(await canSeeBranch(session.user, branchId))) {
    redirect("/chairops?error=forbidden");
  }
  return session;
}

// F9: Raw lookup for maid routes — returns ChairopsUser without isActive filter.
// Use ONLY in the maid layout to differentiate "deactivated" from "no access".
// All other code must use getSession() / requireAuth() which enforces isActive.
export const getMaidUserRaw = cache(async (): Promise<ChairopsUser | null> => {
  const poolSession = await poolGetSession();
  if (!poolSession) return null;
  return prisma.chairopsUser.findFirst({
    where: { authUserId: poolSession.authUserId },
  });
});
