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

/** Admin tier — top 3 roles only. Used to gate sensitive views (monthly PDF
    report, settings, sensitive exports) where area_manager/viewer must NOT
    see organisation-wide P&L or compliance data. */
const ADMIN_TIER_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
];

/**
 * เรียกในหน้า exec (dashboard, reports, leaderboard, heatmap)
 * ผู้จัดการสาขา / staff ที่หลุดเข้ามา → redirect ไป my-branches
 */
export function requireExecutiveRole(role: DbUser["role"]): void {
  if (!EXECUTIVE_ROLES.includes(role)) {
    redirect("/cashhub/my-branches");
  }
}

/**
 * เรียกในหน้าที่จำกัดเฉพาะ admin tier (monthly PDF report, sensitive exports).
 * area_manager / viewer หลุดเข้า → redirect ไป heatmap (ภาพที่เหมาะกับ role พวกเขา)
 */
export function requireAdminTier(role: DbUser["role"]): void {
  if (!ADMIN_TIER_ROLES.includes(role)) {
    redirect("/cashhub/heatmap");
  }
}

export function isExecutiveRole(role: DbUser["role"]): boolean {
  return EXECUTIVE_ROLES.includes(role);
}

export function isAdminTier(role: DbUser["role"]): boolean {
  return ADMIN_TIER_ROLES.includes(role);
}
