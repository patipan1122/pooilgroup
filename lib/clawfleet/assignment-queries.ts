// ClawFleet · ตู้คีบ OS — Wave 3 · queries สำหรับการมอบหมายตู้ (route assignment)
// -----------------------------------------------------------------------------
// อ่านอย่างเดียว · org-scoped ทุก query · กรองตามสาขาที่ผู้ใช้เข้าถึงได้ (userBranchIds).
// ALL = เห็นทุกสาขาใน org (admin/viewer) · ไม่งั้น filter branchId ∈ สาขาที่ได้รับสิทธิ์.
// คืน [] / {} เมื่อ error (หน้าเรียกใน try/catch อยู่แล้ว แต่กันสองชั้น ไม่ให้หน้าแตก).

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";

export type AssignableStaff = { id: string; name: string };

/** แปลง userBranchIds + filter สาขาเดียว → where clause branchId (mirror repair-queries) */
function branchWhere(
  branchIds: string[] | "ALL",
  onlyBranchId?: string,
): { in: string[] } | undefined {
  if (branchIds === "ALL") {
    return onlyBranchId ? { in: [onlyBranchId] } : undefined;
  }
  if (onlyBranchId) {
    return branchIds.includes(onlyBranchId) ? { in: [onlyBranchId] } : { in: [] };
  }
  return { in: branchIds };
}

/**
 * รายชื่อพนักงานที่มอบหมายตู้ให้ได้ — staff/ผจก.สาขา ใน org ที่ผูกสาขา (ในสโคปผู้ใช้).
 * ถ้าระบุ branchId → เฉพาะพนักงานที่ผูกสาขานั้น (ต้องอยู่ในสิทธิ์ผู้ใช้ ไม่งั้นได้ []).
 * เรียงตามชื่อ · unique (คนเดียวผูกหลายสาขาไม่ซ้ำ).
 */
export async function getAssignableStaff(branchId?: string): Promise<AssignableStaff[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    const where = branchWhere(branchIds, branchId);
    // ลิสต์สาขาว่าง ({ in: [] }) = ไม่มีสิทธิ์เห็นสาขาไหนเลย → คืน []
    if (where && where.in.length === 0) return [];

    const rows = await prisma.user.findMany({
      where: {
        orgId,
        isActive: true,
        role: { in: ["staff", "branch_manager"] },
        userBranches: {
          some: where ? { branchId: where } : {},
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

/**
 * map machineId → staffId เฉพาะตู้ที่ถูกมอบหมายแล้ว (assignedStaffId != null).
 * org + branch scope (ถ้าระบุ branchId → เฉพาะสาขานั้น ในสโคปผู้ใช้).
 * ใช้ให้ matrix โชว์ป้าย "👤 ชื่อ" บนตู้ที่ถูก assign.
 */
export async function getMachineAssignments(
  branchId?: string,
): Promise<Record<string, string>> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    const where = branchWhere(branchIds, branchId);
    if (where && where.in.length === 0) return {};

    const rows = await prisma.cfMachine.findMany({
      where: {
        orgId,
        assignedStaffId: { not: null },
        ...(where ? { branchId: where } : {}),
      },
      select: { id: true, assignedStaffId: true },
    });

    const map: Record<string, string> = {};
    for (const r of rows) {
      if (r.assignedStaffId) map[r.id] = r.assignedStaffId;
    }
    return map;
  } catch {
    return {};
  }
}
