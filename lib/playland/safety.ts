"use server";

// Playland · เช็กลิสต์ตรวจความปลอดภัย / ทำความสะอาดรายวัน
// บันทึกไว้เคลมประกัน + กันคดีประมาท (กรมอนามัย/ประกันต้องการ log ก่อนเปิด-ปิดร้าน)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage, canPlaylandAdmin } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newSafetyCheckCode } from "./codes";
import { sanitizeSafetyChecklist } from "./safety-checklist";

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

// ── ตั้งค่าเช็กลิสต์ความปลอดภัยต่อสาขา (admin เท่านั้น · settings = ผู้ดูแล) ──
// MERGE เข้า settings JSON เดิม → ไม่ทับ key อื่น (เช่น maxCapacity · overtimeRatePerMinuteCents)
export async function updateSafetyChecklist(input: {
  branchId: string;
  items: string[];
}): Promise<ActionResult<{ count: number }>> {
  const session = await requireSession();
  if (!canPlaylandAdmin(session.user.role)) return err("เฉพาะผู้ดูแลตั้งค่าเช็กลิสต์ได้");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  const cleaned = sanitizeSafetyChecklist(input.items);
  if (cleaned.length === 0) return err("ต้องมีรายการตรวจอย่างน้อย 1 ข้อ");

  try {
    const branch = await prisma.playlandBranch.findFirst({
      where: { id: input.branchId, orgId: session.user.org_id },
      select: { settings: true },
    });
    if (!branch) return err("ไม่พบสาขา");

    const existing = (branch.settings as Record<string, unknown> | null) ?? {};
    const merged = { ...existing, safetyChecklist: cleaned };

    await prisma.playlandBranch.update({
      where: { id: input.branchId },
      data: { settings: merged as object },
    });

    revalidatePath("/playland/care/safety");
    revalidatePath("/playland/settings/care");
    return { ok: true, data: { count: cleaned.length } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
  }
}

// ── ลบเช็กลิสต์ (ผู้จัดการขึ้นไป · เก็บ snapshot ลง audit ก่อนลบ) ──
export async function deleteSafetyCheck(id: string): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("เฉพาะผู้จัดการขึ้นไปลบได้");
  const rec = await prisma.playlandSafetyCheck.findFirst({ where: { id, orgId: session.user.org_id } });
  if (!rec) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  try {
    await prisma.$transaction([
      prisma.playlandAuditLog.create({
        data: {
          orgId: session.user.org_id, branchId: rec.branchId, actorUserId: session.user.id, actorRole: session.user.role,
          action: "safety.delete", entityType: "PlaylandSafetyCheck", entityId: rec.id,
          before: JSON.parse(JSON.stringify(rec)), category: "general",
        },
      }),
      prisma.playlandSafetyCheck.delete({ where: { id } }),
    ]);
    revalidatePath("/playland/safety");
    return { ok: true, data: { id } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
  }
}
