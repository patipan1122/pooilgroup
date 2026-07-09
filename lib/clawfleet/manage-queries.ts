// ClawFleet · หน้า "จัดการ" (manage hub) — read-side เสริม (server-only).
// -----------------------------------------------------------------------------
// เฉพาะ query ที่ยังไม่มีที่อื่น: "รอบเก็บเงินล่าสุดของตู้ 1 ตัว" (per-machine
// recent collection events) สำหรับแผงรายละเอียดตู้ (read-only · timeline).
// query อื่นที่หน้านี้ใช้ (สาขา+ตู้ · stock overview · loadout · baseline state ·
// repair history) มีอยู่แล้วใน queries.ts / stock-queries.ts / baseline-queries.ts /
// repair-queries.ts — ไม่ทำซ้ำที่นี่ (RULE: อย่าแตะ shared query files).
//
// org-scoped + branch-scoped (userBranchIds) ทุก query · คืน [] เมื่อ error/ไม่มีสิทธิ์.

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";
import type { MachineBaselineState } from "./baseline-queries";
import type { CfMachineLoadoutRow } from "./stock-queries";
import type { RepairTicketRow } from "./repair-queries";

/**
 * รูปทรงข้อมูลรายละเอียดตู้ (รวม 4 read) — นิยามที่นี่ (module ปกติ) แทนไฟล์
 * "use server" ที่ห้าม export type (Next รับเฉพาะ async function).
 */
export type MachineDetailData = {
  baseline: MachineBaselineState;
  loadout: CfMachineLoadoutRow[];
  collections: MachineCollectionRow[];
  repairs: RepairTicketRow[];
};

export type MachineCollectionRow = {
  id: string;
  eventType: string; // INITIAL | COLLECTION | VOID …
  collectedAt: string; // ISO
  collectedByName: string;
  cashCountedCents: number;
  coinMeterBefore: number;
  coinMeterAfter: number;
  isBaseline: boolean; // มาจาก session.isBaseline (รอบตั้งค่าครั้งแรก)
  shortReason: string | null;
};

/**
 * รอบเก็บเงินล่าสุดของตู้ 1 ตัว (ใหม่→เก่า) — สำหรับแผงรายละเอียดตู้ในหน้าจัดการ.
 * อ่านจาก cf_collection_events (per-machine) · join ชื่อผู้เก็บ + flag baseline จาก session.
 * ตู้ต้องอยู่ใน org + สาขาที่ผู้ใช้เข้าถึงได้ (ไม่งั้นคืน []).
 */
export async function getMachineRecentCollections(
  machineId: string,
  limit = 10,
): Promise<MachineCollectionRow[]> {
  if (typeof machineId !== "string" || machineId.length === 0) return [];
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    // ตู้ต้องอยู่ใน org + สาขาที่ผู้ใช้เห็นได้
    const machine = await prisma.cfMachine.findFirst({
      where: {
        id: machineId,
        orgId,
        ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
      },
      select: { id: true },
    });
    if (!machine) return [];

    const rows = await prisma.cfCollectionEvent.findMany({
      where: { orgId, machineId },
      orderBy: { collectedAt: "desc" },
      take: Math.max(1, Math.min(50, limit)),
      select: {
        id: true,
        eventType: true,
        collectedAt: true,
        cashCountedCents: true,
        coinMeterBefore: true,
        coinMeterAfter: true,
        shortReason: true,
        collectedBy: { select: { name: true } },
        session: { select: { isBaseline: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      collectedAt: r.collectedAt.toISOString(),
      collectedByName: r.collectedBy?.name ?? "—",
      cashCountedCents: r.cashCountedCents,
      coinMeterBefore: r.coinMeterBefore,
      coinMeterAfter: r.coinMeterAfter,
      isBaseline: r.session?.isBaseline ?? false,
      shortReason: r.shortReason,
    }));
  } catch {
    return [];
  }
}
