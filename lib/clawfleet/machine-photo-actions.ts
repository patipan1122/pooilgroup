"use server";

// ClawFleet — ตั้ง/เปลี่ยน/ลบ "รูปตู้" (photoUrl) จากหน้า "จัดการ" (manage).
// ฟีเจอร์: บนการ์ดตู้ (โดยเฉพาะตู้ที่ยัง "รอตั้งค่าครั้งแรก") แอดมินแนบรูปตู้ได้
// โดยรูปถูกอัปขึ้น R2 ผ่าน /api/clawfleet/upload (reuse PhotoCaptureButton) แล้ว
// ส่ง public url กลับมาให้ action นี้เขียนลง ClawMachine.photoUrl.
//
// ทำไมแยกไฟล์ (ไม่ใช้ setMachinePhoto เดิม): ตัวเดิมรับได้เฉพาะ url (z.string().url())
// → ลบรูปไม่ได้. อันนี้รับ photoUrl | null → รองรับทั้งตั้ง/เปลี่ยน/ลบ ในตัวเดียว.
//
// ความปลอดภัย: assert แอดมิน ClawFleet (assertCfAdmin) + ตู้ต้องอยู่ org ผู้เรียก.
// idempotent (เขียนค่าเดิมซ้ำได้ · ไม่มีผลข้างเคียง) · money-safe (แตะแค่ field รูป).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { zUUID } from "@/lib/zod-helpers";
import { assertCfAdmin } from "./role-guard";

type Result = { ok: true } | { ok: false; error: string };

// photoUrl: absolute R2 url (มาจาก /api/clawfleet/upload) หรือ null = ลบรูป
const SetCfMachinePhotoSchema = z.object({
  machineId: zUUID("รหัสตู้ไม่ถูกต้อง"),
  photoUrl: z.string().url("ลิงก์รูปไม่ถูกต้อง").nullable(),
});

/**
 * ตั้ง/เปลี่ยน/ลบ รูปตู้ (ClawMachine.photoUrl).
 * @param machineId ตู้เป้าหมาย (ต้องอยู่ใน org ผู้เรียก)
 * @param photoUrl  url รูปบน R2 (absolute) · หรือ null เพื่อลบรูป
 */
export async function setCfMachinePhoto(
  machineId: string,
  photoUrl: string | null,
): Promise<Result> {
  // ── validate input ──
  const parsed = SetCfMachinePhotoSchema.safeParse({ machineId, photoUrl });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  // ── auth: แอดมิน ClawFleet เท่านั้น (redirect /403 ถ้าไม่ใช่) ──
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  // ── org-scope: ตู้ต้องอยู่องค์กรของผู้เรียก (กันแก้ข้ามองค์กร) ──
  const machine = await prisma.cfMachine.findFirst({
    where: { id: parsed.data.machineId, orgId },
    select: { id: true },
  });
  if (!machine) return { ok: false, error: "ไม่พบตู้ในองค์กรนี้" };

  try {
    await prisma.cfMachine.update({
      where: { id: parsed.data.machineId },
      data: { photoUrl: parsed.data.photoUrl }, // null = ลบรูป
    });
    // revalidate หน้า manage (+ branches ใช้ path เดียวกับ CRUD ตู้อื่น)
    revalidatePath("/clawfleet/os/manage");
    revalidatePath("/clawfleet/os/branches");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `บันทึกรูปตู้ไม่สำเร็จ: ${(e as Error).message}` };
  }
}
