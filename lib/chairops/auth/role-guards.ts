// Role hierarchy + privilege-escalation guards
// Per memory [[role-rank-privilege-escalation-guard]] — `requireRole(admin)` is NOT enough.
// Every user-management endpoint MUST check `canAssignRole` / `canManageUser`.
import { type ChairopsUser } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

const RANK: Record<ChairopsUserRole, number> = {
  MAID: 1,
  TECHNICIAN: 1,
  OFFICE: 2,
  MANAGER: 3,
  CEO: 4,
  ADMIN: 5,
};

export function rankOf(role: ChairopsUserRole) {
  return RANK[role];
}

export function canAssignRole(actor: ChairopsUser, targetRole: ChairopsUserRole): boolean {
  // Cannot assign a role at or above your own rank
  return RANK[actor.role] > RANK[targetRole];
}

export function canManageUser(actor: ChairopsUser, target: ChairopsUser): boolean {
  if (actor.id === target.id) return false; // cannot self-modify role
  return RANK[actor.role] > RANK[target.role];
}

export function canSeeBranch(actor: ChairopsUser, branchId: string): boolean {
  // Admin/CEO/Manager see all
  if (RANK[actor.role] >= RANK.MANAGER) return true;
  // Office sees all (reconcile across branches)
  if (actor.role === "OFFICE") return true;
  // Maid sees only her own branch
  return actor.primaryBranchId === branchId;
}

export function canWriteOff(actor: ChairopsUser, amount: number): boolean {
  // <500: MANAGER · ≥500: CEO (per v0.2 BR3 — pending confirm)
  if (amount < 500) return RANK[actor.role] >= RANK.MANAGER;
  return RANK[actor.role] >= RANK.CEO;
}

export function canUnlockCollection(actor: ChairopsUser): boolean {
  return RANK[actor.role] >= RANK.OFFICE;
}

export function canEditPastDay(actor: ChairopsUser): boolean {
  // edits to data > 1 day old need CEO approval (per QC maker/checker)
  return actor.role === "CEO" || actor.role === "ADMIN";
}
