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
  // 2026-06-16 (CEO): program_admin ต้องเห็นทุกฟังก์ชันของโปรแกรมที่ได้รับสิทธิ์.
  // ปลอดภัยเพราะ executive gate เหล่านี้อยู่ "ภายในโปรแกรม" (cashhub/docuflow)
  // ที่ผ่านด่านเข้าโปรแกรม (assertModuleEnabled / module-grant) มาแล้ว →
  // program_admin จะมาถึงด่านนี้ได้ก็ต่อเมื่อถูกติ๊กสิทธิ์โปรแกรมนั้น = grant-scoped.
  // ด่าน "เข้าโปรแกรมไหนได้" ยังพึ่ง isAdminTier เดิม (ไม่แตะ) → ไม่ทะลุระบบติ๊กสิทธิ์.
  "program_admin",
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
// Program-operator tier (CEO 2026-06-16) — admin tier PLUS program_admin.
// ใช้ที่ด่าน "ฟังก์ชันภายในโปรแกรม" (เช่น confirm/void บิล, ออกใบสำคัญจ่าย,
// รายงานในโมดูล, ปุ่ม admin ของโปรแกรม) ที่ผู้ใช้มาถึงได้ก็ต่อเมื่อผ่านด่านเข้า
// โปรแกรม (module-grant) มาแล้ว → ใช้แทน isAdminTier ตรงจุดเหล่านั้นเพื่อปลดให้
// program_admin ที่ได้รับสิทธิ์โปรแกรมนั้นทำงานได้เหมือนแอดมิน.
//
// ⚠️ ห้ามใช้ตัวนี้ที่ด่าน "เข้าโปรแกรมไหนได้บ้าง" (loadUserModules /
// userHasModuleAccess / assertModuleEnabled) — ตรงนั้นต้องคง isAdminTier ไว้
// ไม่งั้น program_admin จะเข้าได้ทุกโปรแกรมแม้ไม่ถูกติ๊กสิทธิ์ (ทะลุระบบ).
// ⚠️ และห้ามใช้กับด่าน "เชื่อมต่อ/secret" (LINE/Drive/API) — ตรงนั้น super_admin เท่านั้น.
const PROGRAM_ADMIN_TIER_ROLES: DbUser["role"][] = [
  ...ADMIN_TIER_ROLES,
  "program_admin",
];

export function isProgramAdminTier(role: DbUser["role"]): boolean {
  return PROGRAM_ADMIN_TIER_ROLES.includes(role);
}

/**
 * เรียกในหน้า/route ฟังก์ชัน "ระดับแอดมินของโปรแกรม" ที่อยู่หลังด่านเข้าโปรแกรม.
 * ตำแหน่งที่ต่ำกว่า (staff/driver) ที่หลุดเข้ามา → redirect ไป heatmap
 * (มิเรอร์ behavior ของ requireAdminTier เดิม).
 */
export function requireProgramAdminTier(role: DbUser["role"]): void {
  if (!isProgramAdminTier(role)) {
    redirect("/cashhub/heatmap");
  }
}

/**
 * Strictest gate — super_admin only. Used by the CostCtrl module (CEO-only
 * cost dashboard) where even org_admin / admin must NOT see provider tokens,
 * monthly spend, or budget rules. Anyone below super_admin is redirected to
 * the regular dashboard.
 */
export function requireSuperAdmin(role: DbUser["role"]): void {
  if (role !== "super_admin") {
    redirect("/dashboard");
  }
}

export function isSuperAdmin(role: DbUser["role"]): boolean {
  return role === "super_admin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-appointment guard (CEO 2026-06-15) — appointing ANY admin-level role is
// reserved to super_admin only. admin/org_admin may add regular staff but must
// NOT create or promote another admin (incl program_admin). The rank rule in
// canAssignRole() is NOT enough on its own — e.g. admin(60) out-ranks
// program_admin(25) and would otherwise be allowed to mint a program-admin.
// ─────────────────────────────────────────────────────────────────────────────
export const ADMIN_LEVEL_ROLES: DbUser["role"][] = [
  "super_admin",
  "org_admin",
  "admin",
  "program_admin",
];

export function isAdminLevelRole(role: DbUser["role"]): boolean {
  return ADMIN_LEVEL_ROLES.includes(role);
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
  // program_admin = admin of specific program(s) only; org-wide rank is low so
  // org_admin/admin can assign it and it can never out-rank a real manager.
  program_admin: 25,
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
