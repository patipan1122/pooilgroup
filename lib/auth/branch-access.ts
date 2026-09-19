// Helper: determine which branches a user can fill reports for
// Different policy per role:
//
//   staff / branch_manager  → only branches in user_branches (assigned)
//   area_manager            → ALL active branches in org (cross-branch)
//   admin / org_admin       → ALL active branches in org
//   super_admin             → ALL active branches in org
//   program_admin           → ALL active branches in org (cross-branch) —
//                             CEO 2026-09-19: reversed the prior exclusion,
//                             now treated the same as admin/org_admin.
//   driver                  → none (uses /driver app)
//   viewer                  → none (read-only)

import { adminClient } from "../db/server";
import type { DbUser } from "./session";

export interface ManageableBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  company_id: string | null;
  is_active: boolean;
}

/** True if this role can fill ANY branch in the org (no user_branches needed) */
export function hasCrossBranchAccess(role: DbUser["role"]): boolean {
  return (
    role === "super_admin" ||
    role === "org_admin" ||
    role === "admin" ||
    role === "area_manager" ||
    // CEO 2026-09-19: program_admin now gets full cross-branch report access,
    // same as admin/org_admin — was previously excluded entirely (see
    // canFillReports() below, and app/api/cashhub/reports/route.ts's isAdmin
    // array, which had drifted out of sync with this function).
    role === "program_admin"
  );
}

/** True if this role can fill reports at all (vs read-only).
 *  CEO 2026-09-19: program_admin is now a valid report-filler, same as the
 *  other admin-tier roles (was previously excluded — see MEMORY
 *  cashhub-program-admin-reports-open-2026-09-19). */
export function canFillReports(role: DbUser["role"]): boolean {
  return role !== "driver" && role !== "viewer";
}

/**
 * True if this branch type submits cash via CashHub (`daily_reports`).
 * ตู้คีบ (claw_machine) ใช้ ClawFleet (`cfCollectionEvent`) คนละ silo — ต้องกันออกจาก /liff/report
 * ไม่งั้นเงินตู้คีบหล่นเข้า daily_reports หายจากการกระทบยอด ClawFleet (CEO 2026-07-11).
 * NOTE: กรองแค่ claw_machine — ไม่รวม massage_chair (ยังไม่ยืนยันว่า ChairOps ใช้ silo ไหน · กันพัง).
 */
export function isCashHubBranch(businessType: string): boolean {
  return businessType !== "claw_machine";
}

/**
 * Returns list of branches a user can fill reports for.
 * - cross-branch roles → all active branches
 * - others → only assigned (user_branches)
 */
export async function loadManageableBranches(
  user: DbUser,
): Promise<ManageableBranch[]> {
  if (!canFillReports(user.role)) return [];

  const admin = adminClient();

  if (hasCrossBranchAccess(user.role)) {
    const { data } = await admin
      .from("branches")
      .select("id, code, name, business_type, province, company_id, is_active")
      .eq("org_id", user.org_id)
      .eq("is_active", true)
      .order("code");
    return (data ?? []) as ManageableBranch[];
  }

  // Per-user assignment via user_branches
  const { data: ub } = await admin
    .from("user_branches")
    .select(
      "branch_id, branches(id, code, name, business_type, province, company_id, is_active)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true);

  const branches: ManageableBranch[] = [];
  for (const u of ub ?? []) {
    const b = Array.isArray(u.branches) ? u.branches[0] : u.branches;
    if (b && (b as { is_active: boolean }).is_active) {
      branches.push(b as ManageableBranch);
    }
  }
  return branches.sort((a, b) => a.code.localeCompare(b.code));
}

/** Check if user can fill report for a specific branch */
export async function canFillForBranch(
  user: DbUser,
  branchId: string,
): Promise<boolean> {
  if (!canFillReports(user.role)) return false;
  if (hasCrossBranchAccess(user.role)) {
    // Just verify branch is in same org
    const admin = adminClient();
    const { data } = await admin
      .from("branches")
      .select("id")
      .eq("id", branchId)
      .eq("org_id", user.org_id)
      .eq("is_active", true)
      .maybeSingle();
    return !!data;
  }
  // Check user_branches link
  const admin = adminClient();
  const { data } = await admin
    .from("user_branches")
    .select("id")
    .eq("user_id", user.id)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}
