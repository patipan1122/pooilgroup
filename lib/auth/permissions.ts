// Permission Matrix per CORE_SYSTEM.md §2.8
// Hardcoded — no UI to edit (Phase 2)

import type { DbUser } from "./session";

export type Module = "cashhub" | "fuelos" | "docuflow" | "admin";
export type CashhubAction = "view" | "create" | "approve" | "unlock" | "export";
export type AdminAction = "manage_users" | "manage_branches" | "view_audit" | "settings";

const MATRIX: Record<DbUser["role"], Record<string, boolean>> = {
  super_admin: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": true,
    "cashhub.unlock": true,
    "cashhub.export": true,
    "admin.manage_users": true,
    "admin.manage_branches": true,
    "admin.view_audit": true,
    "admin.settings": true,
  },
  org_admin: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": true,
    "cashhub.unlock": false,
    "cashhub.export": true,
    "admin.manage_users": true,
    "admin.manage_branches": true,
    "admin.view_audit": true,
    "admin.settings": true,
  },
  // "admin" = mid-level admin (between org_admin and branch_manager) — same as org_admin minus settings
  admin: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": true,
    "cashhub.unlock": false,
    "cashhub.export": true,
    "admin.manage_users": true,
    "admin.manage_branches": true,
    "admin.view_audit": true,
    "admin.settings": false,
  },
  branch_manager: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": true,
    "cashhub.unlock": false,
    "cashhub.export": true,
    "admin.manage_users": false,
    "admin.manage_branches": false,
    "admin.view_audit": false,
    "admin.settings": false,
  },
  // "area_manager" = ดูแลหลายสาขาในเขต — branch_manager + cross-branch view
  area_manager: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": true,
    "cashhub.unlock": false,
    "cashhub.export": true,
    "admin.manage_users": false,
    "admin.manage_branches": false,
    "admin.view_audit": false,
    "admin.settings": false,
  },
  staff: {
    "cashhub.view": true,
    "cashhub.create": true,
    "cashhub.approve": false,
    "cashhub.unlock": false,
    "cashhub.export": false,
    "admin.manage_users": false,
    "admin.manage_branches": false,
    "admin.view_audit": false,
    "admin.settings": false,
  },
  driver: {},
  // program_admin = scoped admin of specific program(s) via user_modules. No
  // Core/CashHub permissions — never org-wide. In-program powers are gated by
  // the module itself (userIsModuleAdmin · half-feature deferred).
  program_admin: {},
  viewer: {
    "cashhub.view": true,
    "cashhub.export": true,
  },
};

export function can(user: DbUser, action: string): boolean {
  return Boolean(MATRIX[user.role]?.[action]);
}

export function isAdmin(user: DbUser): boolean {
  return (
    user.role === "super_admin" ||
    user.role === "org_admin" ||
    user.role === "admin"
  );
}

export function canApproveBranch(
  user: DbUser,
  branchId: string,
  userBranches: string[],
): boolean {
  if (!can(user, "cashhub.approve")) return false;
  if (isAdmin(user)) return true;
  // branch_manager / area_manager — only assigned branches
  return userBranches.includes(branchId);
}
