/**
 * ตู้คีบ OS — รายงานเจาะสาขา (Matrix)
 * ตารางลึก ตู้ × รายวันย้อนหลัง ในหน้าเดียว — เลือกสาขา, สลับค่าในช่อง (ต้นทุน/ยอดเก็บ/ตุ๊กตา/รวม3),
 * สลับช่วง 20/30 วัน, คลิกหัวคอลัมน์เพื่อเจาะดูรายตู้.
 *
 * Server: โหลด "รายชื่อสาขา" จริง (getV2Branches) สำหรับ chips + เมทริกซ์จริง ตู้×วัน
 *         (getMatrixData) ของสาขา/ช่วงที่เลือก (ผ่าน searchParams ?branch & ?days).
 * ทุกตัวเลขในช่อง = ข้อมูลจริงจาก cf_collection_events. DB ว่าง → client โชว์ตัวอย่าง.
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getMatrixData } from "@/lib/clawfleet/matrix-queries";
import { getCfChecklistGrid } from "@/lib/clawfleet/checklist-queries";
import {
  getMachineAssignments,
  getAssignableStaff,
  type AssignableStaff,
} from "@/lib/clawfleet/assignment-queries";
import { requireCfSession, userBranchIds, cfHasAdminPower, isCfBranchManager } from "@/lib/clawfleet/role-guard";
import { getBranchRawReadings, type RawReadingRow } from "@/lib/clawfleet/raw-readings-queries";
import { MatrixClient, type MatrixBranch, type MatrixSerialMachine } from "./matrix-client";
import type { ChecklistBranch } from "./checklist-client";

export const dynamic = "force-dynamic";

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : 20;

  let branches: MatrixBranch[] = [];
  let machines: MatrixSerialMachine[] = [];
  let isoDays: string[] = [];
  let activeBranchCode: string | null = sp.branch ?? null;
  // Wave 3 — มอบหมายตู้ให้พนักงาน (ส่งเข้า client สำหรับ control ในหน้าเจาะตู้)
  let assignments: Record<string, string> = {};
  let staff: AssignableStaff[] = [];
  let canManage = false;
  // เช็คลิสต์ สาขา×วัน ย้อนหลัง 31 วัน (READ-ONLY · scope ผ่าน userBranchIds ในตัว query)
  let checklistIsoDays: string[] = [];
  let checklistBranches: ChecklistBranch[] = [];
  // ข้อมูลดิบมิเตอร์ (โหมดที่ 3) ของสาขาที่เลือก — เลขที่พนักงานกรอกจริง (ตั้งต้น + รอบเก็บ)
  let rawRows: RawReadingRow[] = [];
  let rawTotal = 0;
  let rawTruncated = false;
  let canEditRaw = false;

  try {
    const checklist = await getCfChecklistGrid({ days: 31 });
    checklistIsoDays = checklist.isoDays;
    checklistBranches = checklist.branches;
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ตัวอย่าง
  }

  try {
    const rows = await getV2Branches();
    branches = rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      machines: b.machines,
    }));

    // เลือกสาขา: ตาม ?branch ถ้าอยู่ในรายการ ไม่งั้นสาขาแรก
    const pickedBranch =
      (sp.branch ? branches.find((b) => b.code === sp.branch) : undefined) ?? branches[0] ?? null;
    const picked = pickedBranch?.code ?? null;
    activeBranchCode = picked;

    if (picked && pickedBranch) {
      const data = await getMatrixData({ branchCode: picked, days });
      isoDays = data.isoDays;
      // serialize Map → record (Server→Client ต้องเป็น plain object)
      machines = data.machines.map((m) => ({
        machineId: m.machineId,
        code: m.code,
        nickname: m.nickname,
        days: Object.fromEntries(
          [...m.byDay.entries()].map(([iso, c]) => [
            iso,
            { cash: c.cash, dolls: c.dolls, cost: c.cost, swapped: c.swapped, baseline: c.baseline, collected: c.collected, anomaly: c.anomaly },
          ]),
        ),
      }));

      // มอบหมายตู้ (branch-scoped ด้วย branchId ของสาขาที่เลือก)
      const branchId = pickedBranch.id;
      const session = await requireCfSession();
      // ผจก.สาขา/แอดมิน "ของสาขานี้" เท่านั้นถึงมอบหมายได้ · viewer มอบหมายไม่ได้ (read-only)
      // admin-power ผ่านทุกสาขา · ผจก.สาขาต้องมี branchId ของสาขานี้อยู่ในสังกัด
      const adminPower = await cfHasAdminPower(session);
      if (adminPower) {
        canManage = true;
      } else if (isCfBranchManager(session.user.role)) {
        const scope = await userBranchIds(session);
        canManage = scope !== "ALL" && scope.includes(branchId);
      } else {
        canManage = false;
      }
      assignments = await getMachineAssignments(branchId);
      if (canManage) staff = await getAssignableStaff(branchId);

      // ข้อมูลดิบมิเตอร์ของสาขานี้ (โชว์ทั้งยอดตั้งต้น + รอบเก็บ) + สิทธิ์แก้เลข
      canEditRaw = adminPower || isCfBranchManager(session.user.role);
      const raw = await getBranchRawReadings({ branchCode: picked });
      rawRows = raw.rows;
      rawTotal = raw.total;
      rawTruncated = raw.truncated;
    }
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้สาขาตัวอย่าง + เมทริกซ์ตัวอย่าง
  }

  return (
    <MatrixClient
      branches={branches}
      initialBranch={activeBranchCode}
      isoDays={isoDays}
      machines={machines}
      days={days}
      assignments={assignments}
      staff={staff}
      canManage={canManage}
      checklistIsoDays={checklistIsoDays}
      checklistBranches={checklistBranches}
      rawRows={rawRows}
      rawTotal={rawTotal}
      rawTruncated={rawTruncated}
      canEditRaw={canEditRaw}
    />
  );
}
