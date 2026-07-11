"use server";

// Maid mobile server actions (multi-branch · CEO 2026-07-08).
// Per [[feedback-use-server-only-async-2026-06-02]] exports MUST be async.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireExactRole } from "@/lib/chairops/auth/session";
import {
  getMaidActiveBranches,
  getMaidBranchIds,
  ACTIVE_BRANCH_COOKIE,
} from "@/lib/chairops/auth/branch-scope";

type Result = { ok: true } | { ok: false; error: string };

type MaidBranchState = {
  ok: true;
  branches: Array<{ id: string; name: string }>;
  activeBranchId: string | null;
  activeBranchName: string | null;
};

/**
 * สาขา "สด" ของแม่บ้านคนที่ล็อกอินอยู่ (รายชื่อสาขาที่ดูแล + สาขาที่กำลังทำงาน).
 *
 * ทำไมต้องมี action นี้: ตัวสลับสาขา (BranchSwitcher) รับ props มาจาก layout ซึ่ง
 * Next.js แคชไว้ฝั่ง client + LINE LIFF/PWA เปิดหน้าค้างไว้ → สาขาที่แอดมิน "เพิ่งเพิ่ม"
 * จะไม่โผล่จนกว่าจะ full reload. client เรียก action นี้ตอนเปิด/กลับมาโฟกัสแอป เพื่อ
 * อ่านสาขาจริงจาก DB ใหม่ → เพิ่มสาขาแล้วเห็นทันทีโดยไม่ต้องปิด-เปิดแอป.
 * (ตรรกะ activeBranchId เหมือน layout เป๊ะ = session.user.primaryBranchId ที่ overload
 * เป็นสาขาจาก cookie ∩ ชุดสาขา — ปลอดภัยเรื่องเงิน · การสลับจริงยัง validate ที่ server.)
 */
export async function getMaidBranchState(): Promise<MaidBranchState> {
  const session = await requireExactRole("MAID");
  const branches = await getMaidActiveBranches(session.user.id);
  const activeBranchId = session.user.primaryBranchId ?? null;
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  return {
    ok: true,
    branches,
    activeBranchId,
    activeBranchName: activeBranch?.name ?? null,
  };
}

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
