"use server";

// DC · เอกสารแนบในใบสั่งซื้อ — server actions (ลบ).
// การอัปโหลดทำผ่าน API route /api/dc/po-doc (ส่งไฟล์ได้ ไม่ติดลิมิต 1MB ของ server action).
// ที่นี่มีแค่ "ลบ" — ตรวจสิทธิ์ + scope org เสมอ.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { deleteObject } from "@/lib/r2/upload";

const LIST_PATH = "/dc/office/purchasing";

export type PoDocActionResult = { ok: true } | { ok: false; error: string };

/** ลบเอกสารแนบ 1 ไฟล์ (record + ไฟล์ใน R2). ลบได้เฉพาะผู้จัดการขึ้นไป · scope org. */
export async function deletePoDocument(docId: string): Promise<PoDocActionResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ลบเอกสาร" };
  const orgId = session.user.org_id;

  const doc = await prisma.dcPoDocument.findFirst({
    where: { id: docId, orgId },
    select: { id: true, poId: true, r2Key: true },
  });
  if (!doc) return { ok: false, error: "ไม่พบเอกสารนี้ในองค์กรของคุณ" };

  await prisma.dcPoDocument.delete({ where: { id: doc.id } });
  await deleteObject(doc.r2Key); // best-effort — ไฟล์หลุดค้างไม่กระทบข้อมูล

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${doc.poId}`);
  return { ok: true };
}
