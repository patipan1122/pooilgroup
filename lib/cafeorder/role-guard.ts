// CafeOrder · role guard (mirror DC/Playland pattern)
//   • Admin tier (super/org/admin/program_admin) = full incl. settings/points-policy
//   • area/branch manager = back-office manage (menu, shops, members, reports)
//   • staff = บาริสต้า (KDS) · driver = ไรเดอร์ (field) — gated in their own layouts
//   • viewer = read-only
// Per-branch visibility enforced separately (branch-access).

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";
import { userIsModuleAdmin } from "@/lib/auth/module-access";

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

/**
 * Manage-tier check — true for CAFE_MANAGER_ROLES (no extra query), OR
 * userIsModuleAdmin (covers a plain `staff` member hand-picked as this
 * program's admin via user_modules.role='admin', granted by
 * inviteProgramStaff()). CAFE_MANAGER_ROLES does NOT include "staff" at all
 * (unlike Repairs/Playland), so without this fallback a staff+admin-grant
 * combo would fail even basic menu management — not just the stricter
 * CAFE_ADMIN_ROLES tier below. Same additive OR-composition pattern as
 * lib/auth/module-access.ts's userCanAdminModule, grant-scoped to
 * "cafeorder" only. A member-tier (non-admin) grant, or zero grant, sees no
 * change — userIsModuleAdmin only matches user_modules.role==='admin'.
 */
export async function canCafeManage(user: DbUser): Promise<boolean> {
  if (CAFE_MANAGER_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "cafeorder");
}
export async function requireCafeManager(user: DbUser): Promise<void> {
  if (!(await canCafeManage(user))) redirect("/cafeorder");
}

/**
 * Admin-tier check — true for CAFE_ADMIN_ROLES, OR userIsModuleAdmin. Same
 * composition as canCafeManage above, for the stricter tier (points policy,
 * staff permissions, delete master) — not yet wired to any call site as of
 * this fix (no settings/points-policy page exists yet), fixed here so a
 * future call site is correct from day one.
 */
export async function canCafeAdmin(user: DbUser): Promise<boolean> {
  if (CAFE_ADMIN_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "cafeorder");
}
export async function requireCafeAdmin(user: DbUser): Promise<void> {
  if (!(await canCafeAdmin(user))) redirect("/cafeorder");
}
