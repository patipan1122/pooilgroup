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

export interface Session {
  authUser: { id: string; email?: string | null };
  user: ChairopsUser;
  poolUser: DbUser;
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
    return { authUser: { id: authUserId, email }, user: existing, poolUser: poolDbUser };
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

  return { authUser: { id: authUserId, email }, user, poolUser: poolDbUser };
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
  const { canSeeBranch } = await import("./role-guards");
  if (!canSeeBranch(session.user, branchId)) {
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
