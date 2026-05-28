// ClawFleet — branch-level access guards (per memory role-rank-privilege-escalation-guard)
// Used by all mutation server actions + sensitive queries.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { roleRank } from "@/lib/auth/role-guards";

export const CF_ADMIN_ROLES = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
] as const;

export const CF_BRANCH_ROLES = ["branch_manager"] as const;

export const CF_STAFF_ROLES = ["staff"] as const;

/** All roles that can use ClawFleet at all */
export const CF_ALL_ROLES = [
  ...CF_ADMIN_ROLES,
  ...CF_BRANCH_ROLES,
  ...CF_STAFF_ROLES,
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

/** Branch manager — can manage own branch only */
export function isCfBranchManager(role: Session["user"]["role"]): boolean {
  return role === "branch_manager";
}

/** Staff (filler) — can submit events for own branch */
export function isCfStaff(role: Session["user"]["role"]): boolean {
  return role === "staff";
}

/** Returns array of branch IDs the user is allowed to see */
export async function userBranchIds(session: Session): Promise<string[] | "ALL"> {
  if (isCfAdmin(session.user.role)) return "ALL";
  if (session.user.role === "viewer") return "ALL"; // read-only org-wide
  const rows = await prisma.userBranch.findMany({
    where: { userId: session.user.id },
    select: { branchId: true },
  });
  return rows.map((r) => r.branchId);
}

/**
 * Assert user has access to a specific branch.
 * Used in machine + session + stock mutations.
 */
export async function assertCanAccessBranch(branchId: string): Promise<Session> {
  const session = await requireCfSession();
  if (isCfAdmin(session.user.role) || session.user.role === "viewer") return session;
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
  if (isCfAdmin(session.user.role) || session.user.role === "viewer") return session;
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
  if (isCfAdmin(session.user.role)) return session;
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
  if (!isCfAdmin(session.user.role)) redirect("/403");
  return session;
}

/** Anomaly approval — branch manager (own branch) + admin */
export async function assertCanReviewSession(sessionId: string): Promise<Session> {
  const session = await requireCfSession();
  if (isCfAdmin(session.user.role)) return session;
  if (!isCfBranchManager(session.user.role)) redirect("/403");
  const cfSession = await prisma.cfCollectionSession.findFirst({
    where: { id: sessionId, orgId: session.user.org_id },
    select: { branchId: true, group: { select: { branchId: true } } },
  });
  if (!cfSession) redirect("/404");
  // Resolve the session's branch: v2 branch-level sessions carry branchId directly;
  // legacy group sessions resolve it via their group. If NEITHER is set we cannot
  // verify branch ownership → deny (never silently pass an unscoped session).
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
