"use server";

/**
 * Server action (read-only) — โหลดรายละเอียดตู้ 1 ตัว "ตอนเปิดแผง" ในหน้าจัดการ.
 * รวม 4 read ที่มีอยู่แล้วเป็นก้อนเดียว (ไม่ preload ทุกตู้ตอนเข้าหน้า):
 *   baseline state · loadout ปัจจุบัน · รอบเก็บล่าสุด · ประวัติแจ้งซ่อม.
 * ทุก query ข้างในมี requireCfSession + org/branch scope ของตัวเองอยู่แล้ว →
 * action นี้แค่ยิงขนาน ไม่ mutation ไม่แตะสิทธิ์เพิ่ม. เป็นไฟล์ใหม่ในสโคปหน้า
 * (ไม่แก้ lib/clawfleet/actions.ts).
 */
import { getMachineBaselineState } from "@/lib/clawfleet/baseline-queries";
import { getMachineLoadout } from "@/lib/clawfleet/stock-queries";
import { getMachineRepairHistory } from "@/lib/clawfleet/repair-queries";
import { getMachineRecentCollections, type MachineDetailData } from "@/lib/clawfleet/manage-queries";

export async function loadMachineDetail(machineId: string): Promise<MachineDetailData> {
  const [baseline, loadout, collections, repairHistory] = await Promise.all([
    getMachineBaselineState(machineId),
    getMachineLoadout(machineId),
    getMachineRecentCollections(machineId, 8),
    getMachineRepairHistory(machineId),
  ]);
  return {
    baseline,
    loadout,
    collections,
    repairs: repairHistory.tickets,
  };
}
