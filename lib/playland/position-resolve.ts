// Playland · ตัวแปลง "role สำหรับเช็คสิทธิ์ Playland" จากตำแหน่ง (server-only)
// กฎ: แอดมินระบบ = เต็มเสมอ (ล็อกออกไม่ได้) · มีตำแหน่ง Playland = ใช้ตำแหน่ง · ไม่มี = role ระบบเดิม (backward compat)
// → guard เดิม canPlaylandX/requirePlaylandX ใช้ค่านี้แทน session.user.role ได้เลย (ไม่ต้องแก้ logic guard)

import { prisma } from "@/lib/prisma";
import type { DbUser } from "@/lib/auth/session";
import { canPlaylandAdmin } from "./role-guard";

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
 */
export async function getPlaylandRole(userId: string, orgId: string, orgRole: Role): Promise<Role> {
  // แอดมินระบบ (super/org/admin/program_admin) = เต็มเสมอ · ตำแหน่งไม่ลดสิทธิ์ (กันล็อกตัวเองออก)
  if (canPlaylandAdmin(orgRole)) return orgRole;
  const rows = await prisma.playlandStaffBranch.findMany({ where: { userId, orgId }, select: { position: true } });
  // ตำแหน่งสูงสุดในทุกสาขาที่ผูก
  let top: string | null = null;
  for (const r of rows) if (rank(r.position) > rank(top)) top = r.position;
  if (!top) return orgRole; // ยังไม่กำหนดตำแหน่ง = ใช้ role ระบบเดิม
  return POSITION_TO_ROLE[top] ?? orgRole;
}
