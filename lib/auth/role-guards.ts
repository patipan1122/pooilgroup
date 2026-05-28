// Role guards — block executive views for non-cross-branch roles
// feedback_role_scoped_views.md — ผู้จัดการสาขาห้ามเห็น executive overview

import { redirect } from "next/navigation";
import type { DbUser } from "./session";

/** Roles ที่อนุญาตให้ดูภาพรวมระดับองค์กร (executive matrix, leaderboard, dashboard)
 *
 * 2026-05-20: เพิ่ม `branch_manager` หลัง Branch Manager persona audit เผยว่า
 * ผู้จัดการสาขาถูก block จาก leaderboard ทั้งที่เจ้าของออกแบบให้พนักงาน "แข่งกัน"
 * → branch_manager ควรเห็น leaderboard เพื่อเทียบกับสาขาอื่นได้
 *
 * Note: ยังไม่มี scoped filtering ที่ page-level → ปัจจุบัน branch_manager
 * เห็น all-org data เหมือน area_manager · จุดนี้ตามเจตนาของ leaderboard
 * (เปรียบเทียบกับสาขาอื่น) · ถ้าต้องการ data isolation per branch ในอนาคต
 * ต้องเพิ่ม scoped filter ใน aggregator/executive-matrix
 */
const EXECUTIVE_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "area_manager",
  "branch_manager",
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

// ─────────────────────────────────────────────────────────────────────────────
// Role-hierarchy helpers — prevent privilege escalation in user-management APIs.
// Rule: a caller may only assign / modify users whose role rank is < caller's.
// Without this, an `admin`-tier user could grant `super_admin` to themselves
// or another user via the PATCH endpoint.
// ─────────────────────────────────────────────────────────────────────────────
export const ROLE_RANK: Record<DbUser["role"], number> = {
  super_admin: 100,
  org_admin: 80,
  admin: 60,
  area_manager: 40,
  branch_manager: 30,
  staff: 20,
  driver: 15,
  viewer: 10,
};

export function roleRank(role: DbUser["role"]): number {
  return ROLE_RANK[role] ?? 0;
}

/** Can `caller` assign `target` as a role on another user (or themselves)?
 *  Rule: caller must STRICTLY out-rank target. super_admin can assign super_admin
 *  (peers); admin cannot grant org_admin/super_admin. */
export function canAssignRole(
  caller: DbUser["role"],
  target: DbUser["role"],
): boolean {
  if (caller === "super_admin") return true; // super_admin can assign anything
  return roleRank(caller) > roleRank(target);
}

/** Can `caller` modify `existing` user at all? Same rule as assignment —
 *  caller must out-rank existing. super_admin can manage anyone including peers. */
export function canManageUser(
  caller: DbUser["role"],
  existing: DbUser["role"],
): boolean {
  if (caller === "super_admin") return true;
  return roleRank(caller) > roleRank(existing);
}
