// ChairOps session wrapper — bridges Pool's auth into ChairOps's role model.
//
// Pool already authenticates users via Supabase auth.users (session.authUserId).
// ChairOps has its own ChairopsUser table keyed by authUserId for role/branch data.
//
// Strategy:
//   1) Reuse Pool's `requireSession()` (so Pool's login flow keeps working).
//   2) Look up a matching ChairopsUser row by authUserId.
//   3) If none exists, bootstrap one in-memory derived from Pool's user metadata
//      (so a brand-new Pool admin can still hit /chairops/* without prior seed —
//      they get role=ADMIN). DB row is created on first mutation.
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

// Returns the ChairopsUser bound to the Pool session, creating one on first
// access when missing. Cached per-request via React `cache()` — saves repeated
// DB lookups across layout/page nested server components.
export const getSession = cache(async (): Promise<Session | null> => {
  const poolSession = await poolGetSession();
  if (!poolSession) return null;

  const poolDbUser = poolSession.user;
  const authUserId = poolSession.authUserId;
  const email = poolSession.email ?? poolDbUser.email ?? null;

  const chairUser = await prisma.chairopsUser.findFirst({
    where: { authUserId },
  });

  // SECURITY model (Wave-0 + CEO principle 2026-06-15 [[program-admin-must-just-work]]):
  // We do NOT blanket auto-bootstrap (that once turned any fresh Pool signup into
  // a ChairOps admin). BUT a user who is explicitly authorized for chairops —
  // either Pool admin-tier OR an active `user_modules` chairops grant — IS
  // approved; the grant *is* the approval. For those, bootstrap a ChairopsUser
  // row on first touch so program-admins can actually enter (fixes P0-4,
  // AUDIT_coreperms_2026-06-01). Everyone else → log denial → return null.
  if (!chairUser) {
    const poolIsAdmin = isAdminTier(poolDbUser.role);
    const grantedAdmin =
      poolIsAdmin || (await userIsModuleAdmin(poolDbUser, "chairops"));
    const grantedAny =
      poolIsAdmin || (await userHasModuleAccess(poolDbUser, "chairops"));

    if (grantedAny) {
      // Respect a pre-existing row keyed by email (orphan invite / prior seed)
      // so we never violate the (orgId,email) unique — link authUserId onto it.
      const byEmail = email
        ? await prisma.chairopsUser.findFirst({
            where: { orgId: poolDbUser.org_id, email },
          })
        : null;
      if (byEmail) {
        if (!byEmail.isActive) return null; // deactivated → stay denied
        const linked =
          byEmail.authUserId === authUserId
            ? byEmail
            : await prisma.chairopsUser
                .update({ where: { id: byEmail.id }, data: { authUserId } })
                .catch(() => byEmail);
        return { authUser: { id: authUserId, email }, user: linked, poolUser: poolDbUser };
      }

      // No row yet → create one derived from the grant. ADMIN when granted as
      // program-admin (or Pool admin-tier), else OFFICE.
      const derivedRole = grantedAdmin
        ? ChairopsUserRole.ADMIN
        : ChairopsUserRole.OFFICE;
      try {
        const created = await prisma.chairopsUser.create({
          data: {
            orgId: poolDbUser.org_id,
            authUserId,
            email,
            displayName: poolDbUser.name || email || "ผู้ดูแล",
            role: derivedRole,
            isActive: true,
          },
        });
        // Best-effort audit trail of the auto-grant (don't block on failure).
        try {
          await prisma.chairopsAuditLog.create({
            data: {
              orgId: poolDbUser.org_id,
              userId: created.id,
              action: "access.bootstrap_from_grant",
              entity: "ChairopsUser",
              entityId: created.id,
              metadata: {
                email,
                poolRole: poolDbUser.role,
                derivedRole,
                reason: "user_modules_chairops_grant_or_admin_tier",
              },
            },
          });
        } catch {
          // swallow — access already granted
        }
        return { authUser: { id: authUserId, email }, user: created, poolUser: poolDbUser };
      } catch {
        // Race: a concurrent request created it first — re-fetch by authUserId.
        const retry = await prisma.chairopsUser.findFirst({ where: { authUserId } });
        if (retry?.isActive)
          return { authUser: { id: authUserId, email }, user: retry, poolUser: poolDbUser };
        return null;
      }
    }

    // Not authorized for chairops → log denial → deny (requireAuth redirects).
    // W0: AuditLog.orgId now required · use the Pool user's org_id (cross-
    // schema text reference). See [[chairops-audit-2026-05-25]].
    try {
      await prisma.chairopsAuditLog.create({
        data: {
          orgId: poolDbUser.org_id,
          userId: null,
          action: "access.denied_no_chairops_user",
          entity: "ChairopsUser",
          entityId: authUserId,
          metadata: {
            email,
            poolRole: poolDbUser.role,
            reason: "no_chairops_user_row",
            note: "ขออนุมัติเข้าใช้งาน · admin must approve",
          },
        },
      });
    } catch {
      // swallow — denial still effective via return null
    }
    return null;
  }

  if (!chairUser.isActive) return null;
  // Suppress unused-helper warning while we transition: kept exported for the
  // future admin-approval flow that will derive role from Pool tier.
  void deriveChairopsRoleFromPool;

  return {
    authUser: { id: authUserId, email },
    user: chairUser,
    poolUser: poolDbUser,
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
