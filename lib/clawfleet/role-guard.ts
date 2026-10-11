// ClawFleet — branch-level access guards (per memory role-rank-privilege-escalation-guard)
// Used by all mutation server actions + sensitive queries.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { roleRank } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";

export const CF_ADMIN_ROLES = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
] as const;

export const CF_BRANCH_ROLES = ["branch_manager"] as const;

export const CF_STAFF_ROLES = ["staff"] as const;

/** All roles that can use ClawFleet at all.
 * `program_admin` enters via its user_modules clawfleet grant (layout enforces
 * the grant); admin POWER is grant-scoped via cfHasAdminPower(), NOT this list. */
export const CF_ALL_ROLES = [
  ...CF_ADMIN_ROLES,
  ...CF_BRANCH_ROLES,
  ...CF_STAFF_ROLES,
  "program_admin",
  "viewer",
] as const;

/** Returns session + redirects to /login if not authenticated */
export async function requireCfSession(): Promise<Session> {
  return requireSession();
}

/** Admin tier (super/org/admin/area) — can do anything ClawFleet org-wide */
export function isCfAdmin(role: Session["user"]["role"]): boolean {
  return (CF_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * True when the user can act as a ClawFleet ADMIN: org admin-tier OR a
 * program_admin explicitly granted ClawFleet admin (user_modules role=admin).
 * Grant-scoped — a program_admin of a DIFFERENT program gains NO ClawFleet power.
 */
export async function cfHasAdminPower(session: Session): Promise<boolean> {
  return (
    isCfAdmin(session.user.role) ||
    (await userIsModuleAdmin(session.user, "clawfleet"))
  );
}

/** Branch manager — can manage own branch only */
export function isCfBranchManager(role: Session["user"]["role"]): boolean {
  return role === "branch_manager";
}

/** Staff (filler) — can submit events for own branch */
export function isCfStaff(role: Session["user"]["role"]): boolean {
  return role === "staff";
}

/**
 * Returns array of branch IDs the user is allowed to see.
 *
 * `companyId` (optional, additive — CEO company-switcher project Phase 4
 * clawfleet): when passed, narrows the result to branches belonging to that
 * company. Admin/viewer tiers get "ALL" (no filter at all) when `companyId`
 * is omitted — EXACTLY the pre-existing behavior for every caller that
 * doesn't pass it (hard requirement after the Phase 1 recruit incident:
 * never change a shared function's default behavior). When `companyId` IS
 * passed, admin/viewer no longer get the "ALL" sentinel — they get the
 * concrete array of that company's branch ids, so downstream `branchIds
 * === "ALL" ? {} : { id: { in: branchIds } }` call sites automatically pick
 * up the company scope without each one needing its own branch/company
 * join. Regular staff/branch_manager get their own assigned branches
 * intersected with the company's branches (defense-in-depth — their
 * UserBranch rows already constrain them to one company in practice today,
 * but this guards the case where that ever changes).
 */
export async function userBranchIds(
  session: Session,
  companyId?: string,
): Promise<string[] | "ALL"> {
  const hasFullAccess =
    (await cfHasAdminPower(session)) || session.user.role === "viewer"; // read-only org-wide

  if (!companyId) {
    if (hasFullAccess) return "ALL";
    const rows = await prisma.userBranch.findMany({
      where: { userId: session.user.id },
      select: { branchId: true },
    });
    return rows.map((r) => r.branchId);
  }

  const companyBranches = await prisma.branch.findMany({
    where: { orgId: session.user.org_id, companyId },
    select: { id: true },
  });
  const companyBranchIds = companyBranches.map((b) => b.id);

  if (hasFullAccess) return companyBranchIds;

  const rows = await prisma.userBranch.findMany({
    where: { userId: session.user.id },
    select: { branchId: true },
  });
  const allowedSet = new Set(rows.map((r) => r.branchId));
  return companyBranchIds.filter((id) => allowedSet.has(id));
}

/**
 * Assert user has access to a specific branch.
 * Used in machine + session + stock mutations.
 */
export async function assertCanAccessBranch(branchId: string): Promise<Session> {
  const session = await requireCfSession();
  if ((await cfHasAdminPower(session)) || session.user.role === "viewer") return session;
  const ub = await prisma.userBranch.findFirst({
    where: { userId: session.user.id, branchId },
    select: { id: true },
  });
  if (!ub) redirect("/403");
  return session;
}

/**
 * Assert user can manage machine (read access to its branch).
 * Throws redirect to /403 if not allowed.
 */
export async function assertCanAccessMachine(machineId: string): Promise<Session> {
  const session = await requireCfSession();
  if ((await cfHasAdminPower(session)) || session.user.role === "viewer") return session;
  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId: session.user.org_id },
    select: { branchId: true },
  });
  if (!machine) redirect("/404");
  const ub = await prisma.userBranch.findFirst({
    where: { userId: session.user.id, branchId: machine.branchId },
    select: { id: true },
  });
  if (!ub) redirect("/403");
  return session;
}

/**
 * Assert user can change settings (loadout, group config, threshold).
 * Branch manager + admin tier only.
 */
export async function assertCanManageMachine(machineId: string): Promise<Session> {
  const session = await requireCfSession();
  if ((await cfHasAdminPower(session))) return session;
  if (!isCfBranchManager(session.user.role)) redirect("/403");
  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId: session.user.org_id },
    select: { branchId: true },
  });
  if (!machine) redirect("/404");
  const ub = await prisma.userBranch.findFirst({
    where: { userId: session.user.id, branchId: machine.branchId },
    select: { id: true },
  });
  if (!ub) redirect("/403");
  return session;
}

/** Admin-only operations (delete machine, set tolerance, ฯลฯ) */
export async function assertCfAdmin(): Promise<Session> {
  const session = await requireCfSession();
  if (!(await cfHasAdminPower(session))) redirect("/403");
  return session;
}

/** Anomaly approval — branch manager (own branch) + admin */
export async function assertCanReviewSession(sessionId: string): Promise<Session> {
  const session = await requireCfSession();
  if ((await cfHasAdminPower(session))) return session;
  if (!isCfBranchManager(session.user.role)) redirect("/403");
  const cfSession = await prisma.cfCollectionSession.findFirst({
    where: { id: sessionId, orgId: session.user.org_id },
    // Resolve the session's branch from EITHER its own top-level branchId column
    // (staff-app collect flow sets this directly, groupId may be null) OR its group.
    // Prefer the top-level branchId when present. If BOTH are null we cannot verify
    // ownership → deny (never silently pass an unscoped session).
    select: { branchId: true, group: { select: { branchId: true } } },
  });
  if (!cfSession) redirect("/404");
  const sessionBranchId = cfSession.branchId ?? cfSession.group?.branchId;
  if (!sessionBranchId) redirect("/403");
  const ub = await prisma.userBranch.findFirst({
    where: { userId: session.user.id, branchId: sessionBranchId },
    select: { id: true },
  });
  if (!ub) redirect("/403");
  return session;
}

/** Comparison helper (for future use) */
export function canCfManage(
  callerRole: Session["user"]["role"],
  targetRole: Session["user"]["role"],
): boolean {
  if (callerRole === "super_admin") return true;
  return roleRank(callerRole) > roleRank(targetRole);
}
