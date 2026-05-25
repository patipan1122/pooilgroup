// Playland module — role guard
// Two-tier model:
//   • Admin tier (super/org/admin) = full access including settings, audit, all branches
//   • Branch staff (branch_manager, staff) = cashier workspace + own branch only
//   • Viewer = read-only reports

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";

export const PLAYLAND_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
  "staff",
  "viewer",
];

/** Roles allowed to operate cashier workspace (register / check-in / sell / refund POS) */
export const PLAYLAND_CASHIER_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
  "staff",
];

/** Roles allowed to modify packages, products, devices, promo, members beyond own branch */
export const PLAYLAND_MANAGER_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
];

/** Roles allowed to do destructive ops (delete member, override audit, manage staff, settings) */
export const PLAYLAND_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
];

export function requirePlaylandAccess(role: DbUser["role"]): void {
  if (!PLAYLAND_ROLES.includes(role)) redirect("/home");
}

export function requirePlaylandCashier(role: DbUser["role"]): void {
  if (!PLAYLAND_CASHIER_ROLES.includes(role)) redirect("/playland");
}

export function requirePlaylandManager(role: DbUser["role"]): void {
  if (!PLAYLAND_MANAGER_ROLES.includes(role)) redirect("/playland");
}

export function requirePlaylandAdmin(role: DbUser["role"]): void {
  if (!PLAYLAND_ADMIN_ROLES.includes(role)) redirect("/playland");
}

export function canPlaylandCashier(role: DbUser["role"]): boolean {
  return PLAYLAND_CASHIER_ROLES.includes(role);
}

export function canPlaylandManage(role: DbUser["role"]): boolean {
  return PLAYLAND_MANAGER_ROLES.includes(role);
}

export function canPlaylandAdmin(role: DbUser["role"]): boolean {
  return PLAYLAND_ADMIN_ROLES.includes(role);
}
