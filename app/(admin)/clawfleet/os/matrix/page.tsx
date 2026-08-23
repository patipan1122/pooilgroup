/**
 * ตู้คีบ OS — รายงานเจาะสาขา (Matrix)
 * ตารางลึก ตู้ × รายวันย้อนหลัง ในหน้าเดียว — เลือกสาขา, สลับค่าในช่อง (ต้นทุน/ยอดเก็บ/ตุ๊กตา/รวม3),
 * สลับช่วง 20/30 วัน, คลิกหัวคอลัมน์เพื่อเจาะดูรายตู้.
 *
 * Server: โหลด "รายชื่อสาขา" จริง (getV2Branches) สำหรับ chips + เมทริกซ์จริง ตู้×วัน
 *         (getMatrixData) ของสาขา/ช่วงที่เลือก (ผ่าน searchParams ?branch & ?days).
 * ทุกตัวเลขในช่อง = ข้อมูลจริงจาก cf_collection_events. DB ว่าง → client โชว์ตัวอย่าง.
 */
import { getV2Branches, getPendingRoundCountsByBranch } from "@/lib/clawfleet/queries";
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

/** วันนี้ (เวลาไทย) → "YYYY-MM" ค่าเริ่มต้นของเช็คลิสต์เมื่อไม่ได้ระบุ ?ckym= */
function currentBangkokYm(): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" });
  const [y, m] = fmt.format(new Date()).split("-").map(Number);
  return { year: y, month: m };
}

const YM_RE = /^(\d{4})-(\d{2})$/;
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
/** เลื่อนเดือน (1-based) ไป delta เดือน → "YYYY-MM" */
function shiftYm(year: number, month: number, delta: number): string {
  const zero = month - 1 + delta;
  const y = year + Math.floor(zero / 12);
  const m = ((zero % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; days?: string; ckym?: string }>;
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
  // เช็คลิสต์ สาขา×วัน เต็มเดือนปฏิทิน (READ-ONLY · scope ผ่าน userBranchIds ในตัว query)
  // ?ckym=YYYY-MM เลือกเดือน · ไม่ระบุ/รูปแบบผิด → เดือนปัจจุบัน (เวลาไทย)
  const defaultYm = currentBangkokYm();
  const ymMatch = sp.ckym ? YM_RE.exec(sp.ckym) : null;
  const ymY = ymMatch ? Number(ymMatch[1]) : NaN;
  const ymM = ymMatch ? Number(ymMatch[2]) : NaN;
  const ymValid = ymM >= 1 && ymM <= 12 && ymY >= 2000 && ymY <= 2100;
  const ckYear = ymValid ? ymY : defaultYm.year;
  const ckMonth = ymValid ? ymM : defaultYm.month;
  let checklistYear = ckYear;
  let checklistMonth = ckMonth;
  // ค่าเริ่มต้นคำนวณจาก ckYear/ckMonth ตรง ๆ (ไม่พึ่ง DB) — nav ใช้ได้แม้ query ล้ม/DB ยังไม่ migrate
  let checklistDaysInMonth = new Date(ckYear, ckMonth, 0).getDate();
  let checklistMonthLabel = `${THAI_MONTHS[ckMonth - 1]} ${ckYear + 543}`;
  let checklistPrevYm = shiftYm(ckYear, ckMonth, -1);
  let checklistNextYm = shiftYm(ckYear, ckMonth, 1);
  let checklistBranches: ChecklistBranch[] = [];
  // ข้อมูลดิบมิเตอร์ (โหมดที่ 3) ของสาขาที่เลือก — เลขที่พนักงานกรอกจริง (ตั้งต้น + รอบเก็บ)
  let rawRows: RawReadingRow[] = [];
  let rawTotal = 0;
  let rawTruncated = false;
  let canEditRaw = false;

  try {
    const checklist = await getCfChecklistGrid({ year: ckYear, month: ckMonth });
    checklistYear = checklist.year;
    checklistMonth = checklist.month;
    checklistDaysInMonth = checklist.daysInMonth;
    checklistMonthLabel = checklist.monthLabel;
    checklistPrevYm = checklist.prevYm;
    checklistNextYm = checklist.nextYm;
    checklistBranches = checklist.branches;
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ตัวอย่าง
  }

  try {
    const [rows, pendingByBranch] = await Promise.all([
      getV2Branches(),
      getPendingRoundCountsByBranch().catch(() => ({} as Record<string, number>)),
    ]);
    branches = rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      machines: b.machines,
      // เลขแดงบนแถบสาขา = จำนวนรอบค้าง (OPEN + รอตรวจ) ของสาขานั้น
      pending: pendingByBranch[b.id] ?? 0,
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
            { cash: c.cash, dolls: c.dolls, cost: c.cost, swapped: c.swapped, baseline: c.baseline, collected: c.collected, anomaly: c.anomaly, flagged: c.flagged, flagReviewed: c.flagReviewed, refillOnly: c.refillOnly, refillDolls: c.refillDolls },
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
      checklistYear={checklistYear}
      checklistMonth={checklistMonth}
      checklistDaysInMonth={checklistDaysInMonth}
      checklistMonthLabel={checklistMonthLabel}
      checklistPrevYm={checklistPrevYm}
      checklistNextYm={checklistNextYm}
      checklistBranches={checklistBranches}
      rawRows={rawRows}
      rawTotal={rawTotal}
      rawTruncated={rawTruncated}
      canEditRaw={canEditRaw}
    />
  );
}
