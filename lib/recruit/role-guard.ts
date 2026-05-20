// Recruit module — role guard
// CEO Q3: HR + admin tier can use full features
// Round 1 decision: ใช้ branch_manager + executive ที่มีอยู่ก่อน · Phase 2 ค่อยแยก hr role

import { redirect } from "next/navigation";
import type { DbUser } from "@/lib/auth/session";

/** Roles allowed to access /recruit/* admin pages */
export const RECRUIT_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
  "viewer", // read-only access
];

/** Roles allowed to MODIFY (create posting, change status, etc.) */
export const RECRUIT_WRITE_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
];

/** Roles allowed for sensitive ops (Blacklist remove, settings) */
export const RECRUIT_ADMIN_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
];

export function requireRecruitAccess(role: DbUser["role"]): void {
  if (!RECRUIT_ROLES.includes(role)) {
    redirect("/home");
  }
}

export function requireRecruitWrite(role: DbUser["role"]): void {
  if (!RECRUIT_WRITE_ROLES.includes(role)) {
    redirect("/recruit");
  }
}

export function requireRecruitAdmin(role: DbUser["role"]): void {
  if (!RECRUIT_ADMIN_ROLES.includes(role)) {
    redirect("/recruit");
  }
}

export function canRecruitWrite(role: DbUser["role"]): boolean {
  return RECRUIT_WRITE_ROLES.includes(role);
}

export function canRecruitAdmin(role: DbUser["role"]): boolean {
  return RECRUIT_ADMIN_ROLES.includes(role);
}
