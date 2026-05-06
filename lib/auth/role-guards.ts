// Role guards — block executive views for non-cross-branch roles
// feedback_role_scoped_views.md — ผู้จัดการสาขาห้ามเห็น executive overview

import { redirect } from "next/navigation";
import type { DbUser } from "./session";

/** Roles ที่อนุญาตให้ดูภาพรวมระดับองค์กร (executive matrix, leaderboard, dashboard) */
const EXECUTIVE_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "viewer",
];

/**
 * เรียกในหน้า exec (dashboard, reports, leaderboard, heatmap, monthly-report)
 * ผู้จัดการสาขา / staff ที่หลุดเข้ามา → redirect ไป my-branches
 */
export function requireExecutiveRole(role: DbUser["role"]): void {
  if (!EXECUTIVE_ROLES.includes(role)) {
    redirect("/cashhub/my-branches");
  }
}

export function isExecutiveRole(role: DbUser["role"]): boolean {
  return EXECUTIVE_ROLES.includes(role);
}
