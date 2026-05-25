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

  // SECURITY (Wave-0 fix · audit Phase-1 BE/SA flagged): NO auto-bootstrap.
  // First-touch users used to be auto-granted ADMIN derived from Pool role —
  // that turned any Pool admin (incl. fresh signups) into a ChairOps admin
  // without explicit approval. Now: unknown user → log denial → return null
  // so requireAuth() redirects to access-denied. Admin must explicitly create
  // a ChairopsUser row (future /chairops/access-requests page) before the
  // user can enter the module.
  if (!chairUser) {
    // Best-effort audit (don't block login flow if audit write fails).
    try {
      await prisma.chairopsAuditLog.create({
        data: {
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
    redirect("/chairops/dashboard?error=forbidden");
  }
  return session;
}

/** Exact-role check (no rank fallthrough) — e.g. MAID-only routes. */
export async function requireExactRole(role: ChairopsUserRole): Promise<Session> {
  const session = await requireAuth();
  if (session.user.role !== role) {
    redirect("/chairops/dashboard?error=forbidden");
  }
  return session;
}

export async function requireBranch(branchId: string): Promise<Session> {
  const session = await requireAuth();
  const { canSeeBranch } = await import("./role-guards");
  if (!canSeeBranch(session.user, branchId)) {
    redirect("/chairops/dashboard?error=forbidden");
  }
  return session;
}
