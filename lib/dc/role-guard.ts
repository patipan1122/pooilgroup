// DC Warehouse · role guard (mirror playland pattern)
//   • Admin tier (super/org/admin/program_admin) = full incl. settings/permissions
//   • area/branch manager = back-office manage (PO, masters, reports)
//   • staff = floor ops (receive/transfer/count/issue/move/search/print)
//   • viewer = read-only
// Per-warehouse visibility is enforced separately via DcWarehouseUser (see access.ts).

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";

type Role = DbUser["role"];

/** Anyone allowed to ENTER the module (gated further by user_modules grant in layout). */
export const DC_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager", "staff", "viewer",
];

/** Roles allowed to operate the FLOOR (receive/transfer/count/issue/move/print). */
export const DC_FLOOR_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager", "staff",
];

/** Roles allowed BACK-OFFICE manage (China PO, suppliers, products, warehouses, reports). */
export const DC_MANAGER_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
  "area_manager", "branch_manager",
];

/** Roles allowed destructive/admin ops (approve PO, permissions, delete master). */
export const DC_ADMIN_ROLES: Role[] = [
  "super_admin", "org_admin", "admin", "program_admin",
];

export function requireDcAccess(role: Role): void {
  if (!DC_ROLES.includes(role)) redirect("/home");
}
export function requireDcFloor(role: Role): void {
  if (!DC_FLOOR_ROLES.includes(role)) redirect("/dc");
}
export function requireDcManager(role: Role): void {
  if (!DC_MANAGER_ROLES.includes(role)) redirect("/dc");
}
export function requireDcAdmin(role: Role): void {
  if (!DC_ADMIN_ROLES.includes(role)) redirect("/dc/office");
}

export const canDcFloor = (role: Role) => DC_FLOOR_ROLES.includes(role);
export const canDcManage = (role: Role) => DC_MANAGER_ROLES.includes(role);
export const canDcAdmin = (role: Role) => DC_ADMIN_ROLES.includes(role);
