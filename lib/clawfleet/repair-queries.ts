// ClawFleet · ตู้คีบ OS — Wave 2 · queries สำหรับหน้าแจ้งซ่อม (repairs)
// -----------------------------------------------------------------------------
// อ่านอย่างเดียว · org-scoped ทุก query · กรองตามสาขาที่ผู้ใช้เข้าถึงได้ (userBranchIds).
// ALL = เห็นทุกสาขาใน org (admin/viewer) · ไม่งั้น filter branchId ∈ สาขาที่ได้รับสิทธิ์.
// Date → ISO string (client แปลงเวลาแสดงเอง). branchName ต่อจาก prisma.branch แบบ manual
// (CfRepairTicket ไม่มี relation ไป Branch ใน schema).

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";

export type RepairTicketRow = {
  id: string;
  machineId: string;
  machineCode: string;
  branchId: string;
  branchName: string | null;
  symptom: string;
  note: string | null;
  photoUrls: string[];
  status: string;
  reportedByName: string;
  reportedAt: string; // ISO
  meterResetRequested: boolean;
  proposedCoinMeter: number | null;
  proposedDollStock: number | null;
  resolvedByName: string | null;
  resolvedAt: string | null; // ISO
  resolutionNote: string | null;
};

export type RepairLogRow = {
  id: string;
  action: string;
  byName: string;
  note: string | null;
  createdAt: string; // ISO
};

export type ListRepairOpts = {
  status?: string; // OPEN | IN_PROGRESS | RESOLVED | CANCELLED — ไม่ระบุ = ทุกสถานะ
  branchId?: string; // กรองสาขาเดียว (ต้องอยู่ในสิทธิ์ผู้ใช้ ไม่งั้นถูกตัดออก)
  limit?: number;
};

/**
 * แปลง userBranchIds → where clause branchId.
 * - ALL → ไม่มี filter (undefined)
 * - รายการสาขา → { in: [...] } · ถ้าระบุ branchId เดียว ต้องอยู่ในลิสต์เท่านั้น
 * - ลิสต์ว่าง (ไม่มีสาขาเลย) → { in: [] } = ไม่เห็นอะไร (ปลอดภัยกว่า undefined)
 */
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

/** join ชื่อสาขาแบบ manual (org scope) — คืน Map branchId → name */
async function loadBranchNames(orgId: string, branchIds: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(branchIds));
  if (uniq.length === 0) return new Map();
  try {
    const rows = await prisma.branch.findMany({
      where: { id: { in: uniq }, orgId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch {
    // ชื่อสาขาเป็นข้อมูลเสริม — ถ้า join ล้ม อย่าให้ทั้งหน้าพัง
    return new Map();
  }
}

/**
 * รายการใบแจ้งซ่อม (ใหม่สุดก่อน) · org + branch scope.
 * คืน [] เมื่อ error (หน้าเรียกใน try/catch อยู่แล้ว แต่กันสองชั้น ไม่ให้หน้าแตก).
 */
export async function listRepairTickets(opts?: ListRepairOpts): Promise<RepairTicketRow[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    const where = branchWhere(branchIds, opts?.branchId);
    const rows = await prisma.cfRepairTicket.findMany({
      where: {
        orgId,
        ...(opts?.status ? { status: opts.status } : {}),
        ...(where ? { branchId: where } : {}),
      },
      orderBy: { reportedAt: "desc" },
      take: Math.min(Math.max(opts?.limit ?? 200, 1), 500),
    });

    const names = await loadBranchNames(
      orgId,
      rows.map((r) => r.branchId),
    );

    return rows.map((r) => ({
      id: r.id,
      machineId: r.machineId,
      machineCode: r.machineCode,
      branchId: r.branchId,
      branchName: names.get(r.branchId) ?? null,
      symptom: r.symptom,
      note: r.note,
      photoUrls: r.photoUrls,
      status: r.status,
      reportedByName: r.reportedByName,
      reportedAt: r.reportedAt.toISOString(),
      meterResetRequested: r.meterResetRequested,
      proposedCoinMeter: r.proposedCoinMeter,
      proposedDollStock: r.proposedDollStock,
      resolvedByName: r.resolvedByName,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionNote: r.resolutionNote,
    }));
  } catch {
    return [];
  }
}

/**
 * ประวัติการซ่อมของตู้หนึ่งตัว — ใบแจ้งซ่อมทั้งหมด + timeline log ล่าสุด.
 * org + branch scope (ถ้าไม่มีสิทธิ์เห็นสาขาตู้ → คืนค่าว่าง).
 */
export async function getMachineRepairHistory(
  machineId: string,
): Promise<{ tickets: RepairTicketRow[]; logs: RepairLogRow[] }> {
  const empty = { tickets: [] as RepairTicketRow[], logs: [] as RepairLogRow[] };
  if (typeof machineId !== "string" || machineId.length === 0) return empty;

  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    // ตู้ต้องอยู่ใน org + ในสาขาที่ผู้ใช้เห็นได้
    const machine = await prisma.cfMachine.findFirst({
      where: {
        id: machineId,
        orgId,
        ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
      },
      select: { id: true, branchId: true },
    });
    if (!machine) return empty;

    // ดึงใบแจ้งซ่อมของตู้นี้ก่อน แล้วค่อยดึง log จาก ticketId เหล่านั้น (query เดียวต่อชั้น)
    const rows = await prisma.cfRepairTicket.findMany({
      where: { orgId, machineId },
      orderBy: { reportedAt: "desc" },
      take: 100,
    });

    const logRows =
      rows.length === 0
        ? []
        : await prisma.cfRepairLog.findMany({
            where: { orgId, ticketId: { in: rows.map((t) => t.id) } },
            orderBy: { createdAt: "desc" },
            take: 200,
          });

    const names = await loadBranchNames(orgId, [machine.branchId]);

    const tickets: RepairTicketRow[] = rows.map((r) => ({
      id: r.id,
      machineId: r.machineId,
      machineCode: r.machineCode,
      branchId: r.branchId,
      branchName: names.get(r.branchId) ?? null,
      symptom: r.symptom,
      note: r.note,
      photoUrls: r.photoUrls,
      status: r.status,
      reportedByName: r.reportedByName,
      reportedAt: r.reportedAt.toISOString(),
      meterResetRequested: r.meterResetRequested,
      proposedCoinMeter: r.proposedCoinMeter,
      proposedDollStock: r.proposedDollStock,
      resolvedByName: r.resolvedByName,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionNote: r.resolutionNote,
    }));

    const logs: RepairLogRow[] = logRows.map((l) => ({
      id: l.id,
      action: l.action,
      byName: l.byName,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    }));

    return { tickets, logs };
  } catch {
    return empty;
  }
}

/**
 * ใบแจ้งซ่อมล่าสุดที่ "ฉันเป็นคนแจ้ง" (reportedById = ตัวเอง) — สำหรับหน้ามือถือช่าง/พนักงาน.
 * org scope · ไม่ต้อง branch scope (เห็นเฉพาะใบตัวเองอยู่แล้ว).
 */
export async function listMyRecentRepairTickets(limit?: number): Promise<RepairTicketRow[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;

    const rows = await prisma.cfRepairTicket.findMany({
      where: { orgId, reportedById: session.user.id },
      orderBy: { reportedAt: "desc" },
      take: Math.min(Math.max(limit ?? 20, 1), 100),
    });

    const names = await loadBranchNames(
      orgId,
      rows.map((r) => r.branchId),
    );

    return rows.map((r) => ({
      id: r.id,
      machineId: r.machineId,
      machineCode: r.machineCode,
      branchId: r.branchId,
      branchName: names.get(r.branchId) ?? null,
      symptom: r.symptom,
      note: r.note,
      photoUrls: r.photoUrls,
      status: r.status,
      reportedByName: r.reportedByName,
      reportedAt: r.reportedAt.toISOString(),
      meterResetRequested: r.meterResetRequested,
      proposedCoinMeter: r.proposedCoinMeter,
      proposedDollStock: r.proposedDollStock,
      resolvedByName: r.resolvedByName,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionNote: r.resolutionNote,
    }));
  } catch {
    return [];
  }
}

/**
 * นับใบแจ้งซ่อมที่ยังค้าง (OPEN|IN_PROGRESS) · org + branch scope.
 * ใช้โชว์ badge บนเมนู "แจ้งซ่อม". คืน 0 เมื่อ error.
 */
export async function countOpenRepairs(): Promise<number> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);
    const where = branchWhere(branchIds);

    return await prisma.cfRepairTicket.count({
      where: {
        orgId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        ...(where ? { branchId: where } : {}),
      },
    });
  } catch {
    return 0;
  }
}
