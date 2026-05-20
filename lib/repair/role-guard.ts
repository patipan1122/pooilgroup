// Repair module — role guard (mirrors recruit/role-guard.ts pattern)
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

/** Roles allowed to MODIFY (assign tech, change status, etc.) */
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
