"use server";

// ClawFleet · ตู้คีบ OS — ลำดับการแสดงผลสาขาในตารางเช็คลิสต์ (สาขา × วัน) ที่ CEO
// จัดเรียงเอง (ปุ่ม ▲▼ ใน checklist-client.tsx). ไม่แตะเงิน/ข้อมูลจริง — เป็นแค่
// preference การแสดงผลที่ทุกคนในองค์กรเห็นเหมือนกัน เลยจำกัดแค่ admin-power กดได้
// (เหมือน pattern สิทธิ์ config อื่นของ ClawFleet).
//
// เก็บลำดับแบบ "ส่ง array ลำดับเต็มทั้งชุดมาเขียนทับ" (ไม่ใช่ swap ทีละคู่ฝั่ง server)
// เพื่อกันปัญหาสาขาที่ยังไม่เคยมีลำดับ (null) ปนกับสาขาที่มีอยู่แล้ว — client คำนวณ
// ลำดับใหม่หลังกด ▲▼ แล้วส่งมาเขียนทับทั้งชุดในทรานแซกชันเดียว เขียนซ้ำก็ปลอดภัย.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCfSession, cfHasAdminPower } from "./role-guard";

const MATRIX_PATH = "/clawfleet/os/matrix";

type Result = { ok: true } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const SaveOrderSchema = z.object({
  branchIds: z.array(z.string().uuid()).min(1, "ไม่มีสาขาให้จัดเรียง"),
});

/**
 * บันทึกลำดับสาขาในตารางเช็คลิสต์ — ส่ง branchIds ทั้งชุดตามลำดับที่ต้องการ
 * (index 0 = บนสุด). เขียนทับ sortOrder ของทุกสาขาในชุดนี้ (index*10) ในทรานเดียว.
 * เฉพาะ admin-power (org admin-tier + program_admin ที่ได้ grant ClawFleet) เท่านั้น
 * เพราะเปลี่ยนสิ่งที่ทุกคนเห็นร่วมกัน ไม่ใช่ preference ส่วนตัว.
 */
export async function saveChecklistOrder(branchIds: string[]): Promise<Result> {
  const parsed = SaveOrderSchema.safeParse({ branchIds });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  if (!(await cfHasAdminPower(session))) {
    return err("เฉพาะแอดมินเท่านั้นที่จัดเรียงลำดับสาขาได้");
  }
  const orgId = session.user.org_id;
  const ids = parsed.data.branchIds;

  // กัน id ปลอม/ข้ามองค์กรก่อนเขียน — ต้องเป็นสาขาจริงในองค์กรนี้ครบทุกตัว
  const owned = await prisma.branch.count({ where: { id: { in: ids }, orgId } });
  if (owned !== ids.length) return err("มีสาขาที่ไม่ถูกต้องในรายการ");

  await prisma.$transaction(
    ids.map((branchId, i) =>
      prisma.cfBranchChecklistOrder.upsert({
        where: { branchId },
        create: { orgId, branchId, sortOrder: (i + 1) * 10 },
        update: { sortOrder: (i + 1) * 10 },
      }),
    ),
  );

  revalidatePath(MATRIX_PATH);
  return { ok: true };
}
