import "server-only";
import { getSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { can } from "@/lib/ledger/permissions";
import { prisma } from "@/lib/prisma";

// LedgerLine — who may act on an expense in the LINE/LIFF (mobile) context.
//
// The web back-office gates on the Pool MODULE grant (requireLedgerAccess). But
// field staff capture receipts in LINE and aren't Pool-module users — they're
// `ledger_line_member` rows. This resolver lets them edit/confirm from the LIFF
// according to the SAME money-capability matrix the admin console manages
// (`ledger_permission` via can()), so the two role systems never diverge.
//
//   Pool admin/accountant tier → full actor (matches web).
//   else Pool user holding the ledger grant → staff-level (edit, no confirm).
//   else LINE member (session.line_user_id → active ledger_line_member) → member
//        actor; confirm/branch rights come from can().
//   else null (no access → show the needs-link screen).

export type LedgerActor = {
  orgId: string;
  userId: string; // Pool user id — for createdBy/confirmedBy/audit trail
  kind: "pool" | "member";
  role: string; // ledger role label
  scopeBranchIds: string[];
  allBranches: boolean;
  canConfirm: boolean;
};

export async function resolveLedgerActor(): Promise<LedgerActor | null> {
  const session = await getSession();
  if (!session) return null;
  const orgId = session.user.org_id;
  const userId = session.user.id;
  const role = session.user.role;

  // Pool accountant/admin tier = full rights (identical to the web back-office).
  if (isAdminTier(role) || role === "viewer") {
    return { orgId, userId, kind: "pool", role: "admin", scopeBranchIds: [], allBranches: true, canConfirm: true };
  }
  // A non-admin Pool user who still holds the ledger module grant → staff-level.
  if (await userHasModuleAccess(session.user, "ledger")) {
    return { orgId, userId, kind: "pool", role: "staff", scopeBranchIds: [], allBranches: true, canConfirm: false };
  }
  // LINE member path (the field-staff / mobile case).
  const lineUserId = session.user.line_user_id;
  if (!lineUserId) return null;
  const member = await prisma.ledgerLineMember.findUnique({
    where: { orgId_lineUserId: { orgId, lineUserId } },
    select: { role: true, scopeBranchIds: true, active: true },
  });
  if (!member || !member.active) return null;
  const [allBranches, canConfirm] = await Promise.all([
    can(orgId, member.role, "scope.all_branches"),
    can(orgId, member.role, "expense.confirm"),
  ]);
  return {
    orgId,
    userId,
    kind: "member",
    role: member.role,
    scopeBranchIds: member.scopeBranchIds ?? [],
    allBranches,
    canConfirm,
  };
}

/** Branch-scope guard: may this actor touch an expense tagged to `branchId`? */
export function actorCanReachBranch(actor: LedgerActor, branchId: string | null): boolean {
  if (actor.allBranches) return true;
  if (!branchId) return true; // unbranched/central capture — allow (branch tagged later)
  return actor.scopeBranchIds.includes(branchId);
}
