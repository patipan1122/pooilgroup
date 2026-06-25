"use server";

// Playland · เช็กลิสต์ตรวจความปลอดภัย / ทำความสะอาดรายวัน
// บันทึกไว้เคลมประกัน + กันคดีประมาท (กรมอนามัย/ประกันต้องการ log ก่อนเปิด-ปิดร้าน)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newSafetyCheckCode } from "./codes";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

export type SafetyItem = { label: string; ok: boolean; note?: string };

// ── บันทึกเช็กลิสต์ความปลอดภัย/ทำความสะอาด ──
export async function submitSafetyCheck(input: {
  branchId: string;
  checkType: "safety" | "cleaning";
  shiftLabel?: string;
  items: SafetyItem[];
  note?: string;
}): Promise<ActionResult<{ checkId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์บันทึกเช็กลิสต์"); // พนักงาน (staff) ทำได้
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  const items: SafetyItem[] = (input.items ?? [])
    .filter((i) => i.label?.trim())
    .map((i) => ({ label: i.label.trim(), ok: Boolean(i.ok), note: i.note?.trim() || undefined }));
  if (items.length === 0) return err("ไม่มีรายการตรวจ");

  const allPass = items.every((i) => i.ok);

  const check = await prisma.playlandSafetyCheck.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      checkCode: newSafetyCheckCode(),
      checkType: input.checkType === "cleaning" ? "cleaning" : "safety",
      shiftLabel: input.shiftLabel?.trim() || null,
      itemsJson: items,
      allPass,
      note: input.note?.trim() || null,
      checkedByUserId: session.user.id,
    },
    select: { id: true },
  });

  revalidatePath("/playland/safety");
  return { ok: true, data: { checkId: check.id } };
}
