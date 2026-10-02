// Repair module — role guard
//
// Two-tier permission model:
//   • Role-based: admin/manager tier can write to any ticket.
//   • Assignment-based: staff techs can write to tickets assigned to them
//     (own technician profile). Enforced inside actions, not in the guard.
import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";

// `program_admin` = scoped admin granted via user_modules. The /repairs layout
// gates entry on an active user_modules `repairs` grant FIRST, so listing it
// here only affects users explicitly granted repairs — they get full repairs
// admin (CEO principle [[program-admin-must-just-work]]).
/** Roles allowed to access /repairs/* admin pages */
export const REPAIR_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
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
  "program_admin",
  "area_manager",
  "branch_manager",
];

/** Roles allowed to do sensitive actions (close ticket permanently, edit categories) */
export const REPAIR_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
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

/**
 * Admin-tier check for one module — true for REPAIR_ADMIN_ROLES (no extra
 * query), OR userIsModuleAdmin (covers a staff member hand-picked as this
 * program's admin via user_modules.role='admin', granted by
 * inviteProgramStaff()). Grant-scoped to "repairs" only — same additive
 * OR-composition already established in lib/auth/module-access.ts's
 * userCanAdminModule / requireModuleAdmin, applied here because Repairs has
 * its own local role-array system instead of using role-guards.ts directly.
 * Staff with a member-tier (non-admin) grant, or zero grant, see no change —
 * REPAIR_ROLES (view) and REPAIR_WRITE_ROLES already cover them separately.
 */
export async function canRepairAdmin(user: DbUser): Promise<boolean> {
  if (REPAIR_ADMIN_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "repairs");
}

export async function requireRepairAdmin(user: DbUser): Promise<void> {
  if (!(await canRepairAdmin(user))) {
    redirect("/repairs");
  }
}

export function canRepairWrite(role: DbUser["role"]): boolean {
  return REPAIR_WRITE_ROLES.includes(role);
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
