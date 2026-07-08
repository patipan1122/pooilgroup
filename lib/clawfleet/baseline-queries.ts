// ClawFleet · ตู้คีบ OS — bigfeature WAVE 1A · N1 baseline read-side (server-only)
// -----------------------------------------------------------------------------
// อ่านสถานะ "ตั้งค่าครั้งแรก" ของตู้: locked แล้วหรือยัง · ล็อกเมื่อไหร่ · ยังรอ setup (⚪) ไหม.
//   awaitingSetup = !locked (ตู้ที่ยังไม่มี baseline → grid ต้องขึ้น ⚪ gray · ไม่ใช่ red).
//
// org-scoped ทุก query · getAwaitingSetupMachines กรองตามสาขาที่ผู้ใช้เข้าถึงได้ (userBranchIds).

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";

export type MachineBaselineState = {
  locked: boolean;
  appliedAt: Date | null;
  awaitingSetup: boolean;
};

/**
 * สถานะ baseline ของตู้ 1 ตัว (org-scoped). ตู้ไม่พบ → ถือว่ายังไม่ล็อก (awaitingSetup=true).
 * awaitingSetup = !locked.
 */
export async function getMachineBaselineState(
  machineId: string,
): Promise<MachineBaselineState> {
  const session = await requireCfSession();
  const orgId = session.user.org_id;

  const machine = await prisma.cfMachine.findFirst({
    where: { id: machineId, orgId },
    select: { isFirstBaselineLocked: true, firstBaselineAppliedAt: true },
  });

  const locked = machine?.isFirstBaselineLocked ?? false;
  return {
    locked,
    appliedAt: machine?.firstBaselineAppliedAt ?? null,
    awaitingSetup: !locked,
  };
}

export type AwaitingSetupMachine = {
  id: string;
  code: string;
  nickname: string | null;
  branchId: string;
};

/**
 * รายการตู้ที่ "ยังรอตั้งค่าครั้งแรก" (isFirstBaselineLocked=false) ในสาขาที่ผู้ใช้เข้าถึงได้.
 * ถ้าระบุ branchId → กรองเฉพาะสาขานั้น (ต้องอยู่ใน scope ด้วย · ไม่งั้นคืน []).
 * เฉพาะตู้ active (ตู้ retire แล้วไม่ต้องขึ้นรอ setup).
 */
export async function getAwaitingSetupMachines(
  branchId?: string,
): Promise<AwaitingSetupMachine[]> {
  const session = await requireCfSession();
  const orgId = session.user.org_id;
  const scope = await userBranchIds(session);

  // สร้าง branch filter จาก scope + branchId ที่ขอมา
  let branchFilter: { branchId?: string | { in: string[] } };
  if (scope === "ALL") {
    branchFilter = branchId ? { branchId } : {};
  } else {
    if (branchId) {
      // ขอสาขาที่ไม่อยู่ใน scope → ไม่มีสิทธิ์เห็น
      if (!scope.includes(branchId)) return [];
      branchFilter = { branchId };
    } else {
      if (scope.length === 0) return [];
      branchFilter = { branchId: { in: scope } };
    }
  }

  const rows = await prisma.cfMachine.findMany({
    where: {
      orgId,
      isActive: true,
      isFirstBaselineLocked: false,
      ...branchFilter,
    },
    select: { id: true, code: true, nickname: true, branchId: true },
    orderBy: [{ branchId: "asc" }, { code: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nickname: r.nickname,
    branchId: r.branchId,
  }));
}
