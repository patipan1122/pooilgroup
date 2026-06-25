// Playland · "สาขาที่กำลังทำงานอยู่" (active branch) — อ่านจาก cookie + จำกัดตามสิทธิ์พนักงาน
// ใช้ให้ทุกหน้าหลังบ้านโฟกัสทีละสาขา ไม่ปนกัน
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { listBranches } from "./queries";
import { canPlaylandAdmin } from "./role-guard";
import { getPlaylandRole } from "./position-resolve";

export const PL_BRANCH_COOKIE = "pl_branch";

export type BranchLite = { id: string; name: string };

/**
 * สาขาที่ user คนนี้เข้าถึงได้:
 *  • admin tier (super/org/admin/program_admin) = ทุกสาขา
 *  • พนักงาน/ผู้จัดการสาขา = เฉพาะสาขาที่ถูกผูก (staff_branches)
 *  • ยังไม่ถูกผูกเลย = เห็นทุกสาขา (backward-compatible · ไม่ล็อกคนเดิมจนกว่าจะมอบหมาย)
 */
export async function getAllowedBranchList(orgId: string) {
  const session = await requireSession();
  const all = await listBranches(orgId); // full rows (มี slug/settings · kiosk ต้องใช้)
  if (canPlaylandAdmin(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return all;
  const assigned = await prisma.playlandStaffBranch.findMany({ where: { orgId, userId: session.user.id }, select: { branchId: true } });
  if (assigned.length === 0) return all;
  const ids = new Set(assigned.map((a) => a.branchId));
  return all.filter((b) => ids.has(b.id));
}

/**
 * คืน "สาขาที่กำลังทำงาน" จากสาขาที่เข้าถึงได้ — ลำดับ: ?branch= → cookie → สาขาแรก
 * @param explicit ค่า ?branch= จาก URL (ถ้ามี · ใช้สำหรับ deep link)
 */
export async function getBranchContext(orgId: string, explicit?: string) {
  const full = await getAllowedBranchList(orgId);
  const branches: BranchLite[] = full.map((b) => ({ id: b.id, name: b.name }));
  const store = await cookies();
  const cookieBranch = store.get(PL_BRANCH_COOKIE)?.value;
  const has = (id?: string) => (id && branches.some((b) => b.id === id) ? id : undefined);
  const activeId = has(explicit) ?? has(cookieBranch) ?? branches[0]?.id ?? null;
  const active = branches.find((b) => b.id === activeId) ?? null;
  return { branches, activeId, active };
}
