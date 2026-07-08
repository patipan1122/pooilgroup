"use server";

// Maid mobile server actions (multi-branch · CEO 2026-07-08).
// Per [[feedback-use-server-only-async-2026-06-02]] exports MUST be async.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireExactRole } from "@/lib/chairops/auth/session";
import {
  getMaidBranchIds,
  ACTIVE_BRANCH_COOKIE,
} from "@/lib/chairops/auth/branch-scope";

type Result = { ok: true } | { ok: false; error: string };

/**
 * แม่บ้านสลับ "สาขาที่กำลังทำงานอยู่" (สลับทีละสาขา). เก็บใน cookie แล้ว getSession
 * จะ overload primaryBranchId ให้เป็นสาขานี้ในรอบถัดไป → ทุกหน้า/action ตามสาขานี้.
 *
 * SECURITY: cookie เป็นค่าที่ client แก้ได้ จึงต้อง validate ฝั่ง server ทุกครั้งว่า
 * branchId อยู่ในชุดสาขาที่แม่บ้านคนนี้ถูก assign จริง (getMaidBranchIds) — ป้องกัน
 * การตั้ง cookie เป็นสาขาที่ไม่ใช่ของตัวเองแล้วเห็น/เขียนเงินข้ามสาขา.
 */
export async function setActiveBranch(branchId: string): Promise<Result> {
  const session = await requireExactRole("MAID");
  const allowed = await getMaidBranchIds(session.user);
  if (!allowed.includes(branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  const store = await cookies();
  store.set(ACTIVE_BRANCH_COOKIE, branchId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/chairops",
    // 12 ชม. — พรุ่งนี้ default กลับสาขาหลัก (กันลืมว่าค้างอยู่สาขาไหนข้ามวัน)
    maxAge: 60 * 60 * 12,
  });
  revalidatePath("/chairops/m");
  return { ok: true };
}
