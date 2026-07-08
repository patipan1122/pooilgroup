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

// NOTE: canSeeBranch moved to ./branch-scope.ts and is now ASYNC (multi-branch,
// CEO 2026-07-08). A maid may manage several branches, so the check must read her
// active ChairopsMaidAssignment rows — see lib/chairops/auth/branch-scope.ts.
// Every caller MUST await it (un-awaited async = truthy Promise = always true).

export function canWriteOff(actor: ChairopsUser, amount: number): boolean {
  // <500: MANAGER · ≥500: CEO (per v0.2 BR3 — pending confirm)
  if (amount < 500) return RANK[actor.role] >= RANK.MANAGER;
  return RANK[actor.role] >= RANK.CEO;
}

// BR7 single-approver exception (CEO 2026-06-25):
// องค์กรที่มีผู้อนุมัติคนเดียว (superadmin = ADMIN) จะ deadlock ถ้า maker-checker
// บังคับ "ผู้ขอ ≠ ผู้อนุมัติ" เพราะ ADMIN เป็นทั้งคนสร้างคำขอและคนอนุมัติ.
// → อนุญาตเฉพาะ ADMIN ให้อนุมัติคำขอของตัวเองได้ (waive BR7). บทบาทอื่นยังติด
//   maker-checker เหมือนเดิม. ทุกครั้งที่ ADMIN อนุมัติเอง audit จะ stamp
//   selfApproved=true และ UI จะติดป้าย "อนุมัติเอง" (ตรวจได้จาก approverId === makerId)
//   เพื่อความโปร่งใส. ดู memory [[chairops-writeoff-single-approver-superadmin-2026-06-25]].
export function canSelfApproveWriteOff(actor: ChairopsUser): boolean {
  return actor.role === "ADMIN";
}

export function canUnlockCollection(actor: ChairopsUser): boolean {
  return RANK[actor.role] >= RANK.OFFICE;
}

export function canEditPastDay(actor: ChairopsUser): boolean {
  // edits to data > 1 day old need CEO approval (per QC maker/checker)
  return actor.role === "CEO" || actor.role === "ADMIN";
}
