"use server";

// ClawFleet · ตู้คีบ OS — Wave 3 · มอบหมายตู้ให้พนักงานเก็บ (route assignment)
// -----------------------------------------------------------------------------
// ทำไมมี: บางสาขาอยากล็อกว่า "ตู้ตัวนี้ให้พนักงานคนนี้เก็บ" (opt-in) แทนที่ใครก็เก็บได้.
//   assignedStaffId = null → ทุกคนในสาขาเก็บได้เหมือนเดิม (ค่าเริ่มต้น · ไม่บังคับ).
//
// สิทธิ์: ผจก.สาขา/แอดมิน "ของสาขาตู้นี้" เท่านั้น (mirror pattern repair-actions.ts) —
//   userBranchIds(session): "ALL" = admin-power (แอดมิน+program_admin) ผ่านทุกสาขา ·
//   ไม่งั้น = list สาขาที่ user สังกัด → machine.branchId ต้องอยู่ในลิสต์ + เป็น ผจก.สาขา.
// org-scoped ทุก mutation · audit_log ทุกครั้ง (old/new staffId).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds, isCfBranchManager, cfHasAdminPower } from "./role-guard";

const MATRIX_PATH = "/clawfleet/os/matrix";

type Result = { ok: true } | { ok: false; error: string };

function err(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const AssignSchema = z.object({
  machineId: z.string().uuid("ไม่ระบุตู้"),
  // null = ยกเลิกมอบหมาย · uuid = มอบให้พนักงานคนนั้น
  staffId: z.string().uuid("พนักงานไม่ถูกต้อง").nullable(),
});

/**
 * มอบหมายตู้ให้พนักงานเก็บ (หรือยกเลิกเมื่อ staffId = null).
 *
 * - ผจก.สาขา/แอดมิน ของสาขาตู้นี้เท่านั้น (branch-scoped).
 * - staffId ต้องเป็นพนักงาน (staff/branch_manager) ใน org เดียวกัน + ผูกสาขาเดียวกับตู้
 *   (กันมอบตู้ให้คนที่ไม่มีสิทธิ์เข้าสาขานั้น).
 * - idempotent: มอบค่าเดิมซ้ำ = no-op (ไม่เขียน audit ซ้ำ).
 * - เขียน assignedStaffId + audit_log (CF_MACHINE_ASSIGN · old/new) ในทรานเดียว.
 */
export async function assignMachineToStaff(
  machineId: string,
  staffId: string | null,
): Promise<Result> {
  const parsed = AssignSchema.safeParse({ machineId, staffId });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const data = parsed.data;

  let session: Awaited<ReturnType<typeof requireCfSession>>;
  try {
    session = await requireCfSession();
  } catch (e) {
    return err((e as Error).message);
  }
  const orgId = session.user.org_id;

  // โหลดตู้ (org scope) → snapshot branchId + ค่ามอบหมายเดิม
  const machine = await prisma.cfMachine.findFirst({
    where: { id: data.machineId, orgId },
    select: { id: true, branchId: true, assignedStaffId: true },
  });
  if (!machine) return err("ไม่พบตู้ในองค์กรนี้");

  // CHECKER guard + scope สาขา — ผจก.สาขา/แอดมิน "ของสาขาตู้นี้" เท่านั้น (viewer มอบหมายไม่ได้)
  // admin-power (แอดมิน+program_admin grant) ผ่านทุกสาขา · ผจก.สาขาเข้าเฉพาะสาขาตัวเอง ·
  // viewer (read-only org-wide) เขียนไม่ได้ — ห้ามใช้ scope==="ALL" ตัดสิน admin (viewer ก็ได้ "ALL").
  const adminPower = await cfHasAdminPower(session);
  const isManager = adminPower || isCfBranchManager(session.user.role);
  if (!isManager) return err("เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่มอบหมายตู้ได้");
  if (!adminPower) {
    const scope = await userBranchIds(session);
    if (scope !== "ALL" && !scope.includes(machine.branchId)) {
      return err("ไม่มีสิทธิ์ในสาขานี้");
    }
  }

  // ถ้ามอบให้พนักงาน — ตรวจว่าเป็นพนักงาน (staff/ผจก.สาขา) ใน org + ผูกสาขาเดียวกับตู้
  if (data.staffId != null) {
    const staff = await prisma.user.findFirst({
      where: {
        id: data.staffId,
        orgId,
        isActive: true,
        role: { in: ["staff", "branch_manager"] },
        userBranches: { some: { branchId: machine.branchId } },
      },
      select: { id: true },
    });
    if (!staff) return err("พนักงานคนนี้ไม่ได้อยู่ในสาขาของตู้ · มอบหมายไม่ได้");
  }

  // idempotent — ค่าเดิมซ้ำ = no-op (กดปุ่มเดิม/เลือกค่าเดิม = ผลเท่าเดิม · ไม่เขียน audit ซ้ำ)
  if (machine.assignedStaffId === data.staffId) {
    revalidatePath(MATRIX_PATH);
    return { ok: true };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // atomic claim — เขียนได้ต่อเมื่อค่าเดิมยังไม่เปลี่ยน (กัน 2 คนมอบพร้อมกัน)
      const claim = await tx.cfMachine.updateMany({
        where: { id: machine.id, orgId, assignedStaffId: machine.assignedStaffId },
        data: { assignedStaffId: data.staffId },
      });
      if (claim.count !== 1) {
        throw new Error("การมอบหมายตู้นี้เพิ่งถูกเปลี่ยนไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_MACHINE_ASSIGN",
          resourceType: "CF_MACHINE",
          resourceId: machine.id,
          diff: {
            old: { assignedStaffId: machine.assignedStaffId },
            new: { assignedStaffId: data.staffId },
          },
        },
      });
    });

    revalidatePath(MATRIX_PATH);
    return { ok: true };
  } catch (e) {
    return err(`มอบหมายตู้ไม่สำเร็จ: ${(e as Error).message}`);
  }
}
