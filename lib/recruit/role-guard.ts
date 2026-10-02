// Recruit module — role guard
// CEO Q3: HR + admin tier can use full features
// Round 1 decision: ใช้ branch_manager + executive ที่มีอยู่ก่อน · Phase 2 ค่อยแยก hr role
//
// 2026-10-02: Recruit is the one module that still gated purely on org-wide
// role tier (RECRUIT_ROLES / RECRUIT_WRITE_ROLES / RECRUIT_ADMIN_ROLES below),
// with NO fallback to a per-module user_modules grant. inviteProgramStaff()
// mints a plain org-role "staff" user + a user_modules grant scoped to one
// program — but `staff` is not a member of ANY of the three arrays below, so
// an invited staff member with an active recruit grant was bounced to /403 on
// every recruit page, at every tier (view/write/admin) — not just the
// write/admin gap other modules had. Same root cause as the DocuFlow fix
// (see lib/auth/module-access.ts userCanViewModule/userCanAdminModule +
// postmortems/staff-invite-grant-access-gate-2026-09-30.md), but DocuFlow's
// local gate WAS the shared role-guards.ts tiers (EXECUTIVE_ROLES /
// PROGRAM_ADMIN_TIER_ROLES), so it could drop in the centralized helpers
// directly. Recruit's three arrays are its OWN local sets — RECRUIT_WRITE_ROLES
// in particular is not equal to PROGRAM_ADMIN_TIER_ROLES (it additionally
// includes area_manager/branch_manager) — so reusing the centralized
// userCanViewModule/userCanAdminModule here would silently change Recruit's
// write-tier membership. Instead this file composes the SAME shape
// (role-tier array membership OR a user_modules grant check), using
// Recruit's own arrays and the module-access.ts primitives directly:
//   - view tier   → RECRUIT_ROLES.includes(role)       OR any active grant (userHasModuleAccess)
//   - write tier  → RECRUIT_WRITE_ROLES.includes(role)  OR grant.role === 'admin' (userIsModuleAdmin)
//   - admin tier  → RECRUIT_ADMIN_ROLES.includes(role)  OR grant.role === 'admin' (userIsModuleAdmin)
// A staff member with a 'member' grant gets view only; a staff member with an
// 'admin' grant (module-admin-promoted staff) gets view+write+admin — matching
// what every other module's staff-admin grant already means.
//
// Deliberately does NOT touch the self-serve invite carve-out in
// app/(admin)/recruit/settings/team-actions.ts (CEO 2026-09-06) — that flow
// already calls userIsModuleAdmin() directly and always mints a peer
// program_admin, never plain staff; it is a different, already-correct
// mechanism solving a different problem.

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";
import { userHasModuleAccess, userIsModuleAdmin } from "@/lib/auth/module-access";

// `program_admin` = scoped admin of programs granted via user_modules. The
// /recruit layout gates entry on an active user_modules `recruit` grant FIRST,
// so listing program_admin here only affects users who were explicitly granted
// recruit — they get full recruit admin (CEO principle [[program-admin-must-just-work]]).
/** Roles allowed to access /recruit/* admin pages */
export const RECRUIT_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
  "area_manager",
  "branch_manager",
  "viewer", // read-only access
];

/** Roles allowed to MODIFY (create posting, change status, etc.) */
export const RECRUIT_WRITE_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
  "area_manager",
  "branch_manager",
];

/** Roles allowed for sensitive ops (Blacklist remove, settings) */
export const RECRUIT_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
];

/** View-tier check — RECRUIT_ROLES tier, OR any active recruit grant
 * (member or admin) via user_modules. Lets an invited staff member view the
 * one program they were granted without widening RECRUIT_ROLES itself. */
export async function canRecruitAccess(user: DbUser): Promise<boolean> {
  if (RECRUIT_ROLES.includes(user.role)) return true;
  return userHasModuleAccess(user, "recruit");
}

/** Write-tier check — RECRUIT_WRITE_ROLES tier, OR a recruit grant with
 * role='admin' (userIsModuleAdmin). A plain 'member' grant does NOT clear
 * this — matches the spec: staff needs the module-admin grant for write. */
export async function canRecruitWrite(user: DbUser): Promise<boolean> {
  if (RECRUIT_WRITE_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "recruit");
}

/** Admin-tier check (sensitive ops) — RECRUIT_ADMIN_ROLES tier, OR a
 * recruit grant with role='admin' (userIsModuleAdmin). */
export async function canRecruitAdmin(user: DbUser): Promise<boolean> {
  if (RECRUIT_ADMIN_ROLES.includes(user.role)) return true;
  return userIsModuleAdmin(user, "recruit");
}

export async function requireRecruitAccess(user: DbUser): Promise<void> {
  if (!(await canRecruitAccess(user))) {
    redirect("/home");
  }
}

export async function requireRecruitWrite(user: DbUser): Promise<void> {
  if (!(await canRecruitWrite(user))) {
    redirect("/recruit");
  }
}

export async function requireRecruitAdmin(user: DbUser): Promise<void> {
  if (!(await canRecruitAdmin(user))) {
    redirect("/recruit");
  }
}
