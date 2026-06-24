// Playland · "สาขาที่กำลังทำงานอยู่" (active branch) — อ่านจาก cookie
// ใช้ให้ทุกหน้าหลังบ้านโฟกัสทีละสาขา ไม่ปนกัน · Phase B จะกรองตามสิทธิ์พนักงานเพิ่ม
import { cookies } from "next/headers";
import { listBranches } from "./queries";

export const PL_BRANCH_COOKIE = "pl_branch";

export type BranchLite = { id: string; name: string };

/**
 * คืน "สาขาที่กำลังทำงาน" — ลำดับ: ?branch= ที่ส่งมา → cookie → สาขาแรก
 * @param explicit ค่า ?branch= จาก URL (ถ้ามี · ใช้สำหรับ deep link)
 */
export async function getBranchContext(orgId: string, explicit?: string) {
  const all = await listBranches(orgId);
  const branches: BranchLite[] = all.map((b) => ({ id: b.id, name: b.name }));
  const store = await cookies();
  const cookieBranch = store.get(PL_BRANCH_COOKIE)?.value;
  const has = (id?: string) => (id && branches.some((b) => b.id === id) ? id : undefined);
  const activeId = has(explicit) ?? has(cookieBranch) ?? branches[0]?.id ?? null;
  const active = branches.find((b) => b.id === activeId) ?? null;
  return { branches, activeId, active };
}
