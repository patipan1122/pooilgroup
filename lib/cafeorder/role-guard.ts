// CafeOrder · role guard (mirror DC/Playland pattern)
//   • Admin tier (super/org/admin/program_admin) = full incl. settings/points-policy
//   • area/branch manager = back-office manage (menu, shops, members, reports)
//   • staff = บาริสต้า (KDS) · driver = ไรเดอร์ (field) — gated in their own layouts
//   • viewer = read-only
// Per-branch visibility enforced separately (branch-access).

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";

type Role = DbUser["role"];

/** Anyone allowed to ENTER the module (gated further by user_modules grant in layout). */
export const CAFE_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager", "staff", "driver", "viewer",
];

/** Back-office manage (menu, shops, members, reports). */
export const CAFE_MANAGER_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager",
];

/** Admin-only ops (points policy, staff permissions, delete master). */
export const CAFE_ADMIN_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
];

export function requireCafeAccess(role: Role): void {
  if (!CAFE_ROLES.includes(role)) redirect("/home");
}
export function requireCafeManager(role: Role): void {
  if (!CAFE_MANAGER_ROLES.includes(role)) redirect("/cafeorder");
}
export function requireCafeAdmin(role: Role): void {
  if (!CAFE_ADMIN_ROLES.includes(role)) redirect("/cafeorder");
}

export const canCafeManage = (role: Role) => CAFE_MANAGER_ROLES.includes(role);
export const canCafeAdmin = (role: Role) => CAFE_ADMIN_ROLES.includes(role);
