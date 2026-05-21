// Repair module — role guard
//
// Two-tier permission model:
//   • Role-based: admin/manager tier can write to any ticket.
//   • Assignment-based: staff techs can write to tickets assigned to them
//     (own technician profile). Enforced inside actions, not in the guard.
import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";

/** Roles allowed to access /repairs/* admin pages */
export const REPAIR_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
  "staff",
  "viewer",
];

/** Roles allowed to MODIFY any ticket (assign tech, change status, etc.) */
export const REPAIR_WRITE_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
];

/** Roles allowed to do sensitive actions (close ticket permanently, edit categories) */
export const REPAIR_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
];

/**
 * Roles that may write to tickets *only when assigned* (own-job tier).
 * Combined with assignment check in server actions.
 */
export const REPAIR_OWN_JOB_ROLES: DbUser["role"][] = ["staff"];

export function requireRepairAccess(role: DbUser["role"]): void {
  if (!REPAIR_ROLES.includes(role)) {
    redirect("/home");
  }
}

export function requireRepairWrite(role: DbUser["role"]): void {
  if (!REPAIR_WRITE_ROLES.includes(role)) {
    redirect("/repairs");
  }
}

export function requireRepairAdmin(role: DbUser["role"]): void {
  if (!REPAIR_ADMIN_ROLES.includes(role)) {
    redirect("/repairs");
  }
}

export function canRepairWrite(role: DbUser["role"]): boolean {
  return REPAIR_WRITE_ROLES.includes(role);
}

export function canRepairAdmin(role: DbUser["role"]): boolean {
  return REPAIR_ADMIN_ROLES.includes(role);
}

/** Can this user act on this specific ticket (admin tier OR assigned tech)? */
export function canRepairActOnTicket(
  role: DbUser["role"],
  userId: string,
  ticketAssignedTechUserId: string | null,
): boolean {
  if (canRepairWrite(role)) return true;
  if (REPAIR_OWN_JOB_ROLES.includes(role) && ticketAssignedTechUserId === userId) return true;
  return false;
}
