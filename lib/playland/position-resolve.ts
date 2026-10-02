// Playland · ตัวแปลง "role สำหรับเช็คสิทธิ์ Playland" จากตำแหน่ง (server-only)
// กฎ: แอดมินระบบ = เต็มเสมอ (ล็อกออกไม่ได้) · มีตำแหน่ง Playland = ใช้ตำแหน่ง · ไม่มี = role ระบบเดิม (backward compat)
// → guard เดิม canPlaylandX/requirePlaylandX ใช้ค่านี้แทน session.user.role ได้เลย (ไม่ต้องแก้ logic guard)

import { prisma } from "@/lib/prisma";
import type { DbUser } from "@/lib/auth/session";
import { canPlaylandAdmin } from "./role-guard";
import { userIsModuleAdmin } from "@/lib/auth/module-access";

type Role = DbUser["role"];

// ตำแหน่ง Playland → role สังเคราะห์ (ใช้กับ guard เดิม)
const POSITION_TO_ROLE: Record<string, Role> = {
  owner: "admin", // เจ้าของร้าน = สิทธิ์เต็มใน Playland
  manager: "branch_manager",
  cashier: "staff",
};
const rank = (p: string | null | undefined) => (p === "owner" ? 3 : p === "manager" ? 2 : p === "cashier" ? 1 : 0);

/**
 * คืน role ที่ใช้เช็คสิทธิ์ "ใน Playland เท่านั้น"
 * @param userId  session.user.id
 * @param orgId   session.user.org_id
 * @param orgRole session.user.role (role ระบบ — ใช้เป็น fallback + ปกป้องแอดมินระบบ)
 *
 * 2026-10-02 fix: this is the ONLY place every canPlaylandAdmin/requirePlaylandAdmin
 * (and canPlaylandManage/requirePlaylandManager, canPlaylandCashier) call site in the
 * module reads its effective role from — every one of them passes the value returned
 * here, never a raw DbUser, so the user_modules admin-tier grant composition used
 * elsewhere (lib/auth/module-access.ts's userCanAdminModule) has to be wired in HERE,
 * not in role-guard.ts, or it would never be reachable from any real call site. A
 * plain `staff` user holding a user_modules grant with role='admin' for "playland"
 * (minted by inviteProgramStaff() or hand-picked via team settings) is elevated to
 * synthetic "admin" — same as a staff-branch position of "owner" — regardless of
 * their playlandStaffBranch position, so admin tooling (settings, audit, overrides,
 * team) opens for them. A member-tier (non-admin) grant does NOT match here
 * (userIsModuleAdmin only matches user_modules.role==='admin'), so it falls through
 * unchanged to the existing position/org-role resolution below — view/cashier access
 * for a member-tier or zero-grant staff member is completely unaffected.
 */
export async function getPlaylandRole(userId: string, orgId: string, orgRole: Role): Promise<Role> {
  // แอดมินระบบ (super/org/admin/program_admin) = เต็มเสมอ · ตำแหน่งไม่ลดสิทธิ์ (กันล็อกตัวเองออก)
  if (canPlaylandAdmin(orgRole)) return orgRole;

  // Minimal DbUser shell for userIsModuleAdmin — it only reads .id/.org_id/.role;
  // the unused fields are filled with inert defaults so this satisfies the full
  // DbUser type without an unsafe cast.
  const grantUser: DbUser = {
    id: userId,
    org_id: orgId,
    role: orgRole,
    email: null,
    name: "",
    phone: null,
    line_user_id: null,
    telegram_user_id: null,
    telegram_chat_id: null,
    is_active: true,
  };

  const [moduleAdmin, rows] = await Promise.all([
    userIsModuleAdmin(grantUser, "playland"),
    prisma.playlandStaffBranch.findMany({ where: { userId, orgId }, select: { position: true } }),
  ]);
  if (moduleAdmin) return "admin";

  // ตำแหน่งสูงสุดในทุกสาขาที่ผูก
  let top: string | null = null;
  for (const r of rows) if (rank(r.position) > rank(top)) top = r.position;
  if (!top) return orgRole; // ยังไม่กำหนดตำแหน่ง = ใช้ role ระบบเดิม
  return POSITION_TO_ROLE[top] ?? orgRole;
}
