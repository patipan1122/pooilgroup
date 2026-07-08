/**
 * ตู้คีบ OS — สาขา (Branches)
 * Server: ดึง P&L รายสาขา (จริง) ใน try/catch → ส่งให้ client.
 * ถ้า DB ว่าง/ยังไม่ migrate → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */
import { getBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { getBranchMachineInfo, type MachineDotStatus } from "@/lib/clawfleet/dashboard-queries";
import { getCfMachinesForBranchAdmin } from "@/lib/clawfleet/stock-queries";
import { getV2Branches } from "@/lib/clawfleet/queries";
import { requireCfSession, cfHasAdminPower } from "@/lib/clawfleet/role-guard";
import { BranchesClient, type BranchRow, type MachineOption, type BranchOption } from "./branches-client";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let machineInfo: Awaited<ReturnType<typeof getBranchMachineInfo>> | null = null;
  // surface-existing (reassign UI) — ต้องรู้ว่าเป็นแอดมินไหม (server assert อยู่แล้ว · UI แค่ซ่อน/แสดง)
  let isAdmin = false;
  let machineOptions: MachineOption[] = [];
  let branchOptions: BranchOption[] = [];
  try {
    const session = await requireCfSession();
    isAdmin = await cfHasAdminPower(session);
    // โหลดตู้ + สาขา เฉพาะแอดมิน (คนอื่นไม่เห็นปุ่มย้าย → ไม่ต้องโหลด)
    if (isAdmin) {
      const [ms, bs] = await Promise.all([getCfMachinesForBranchAdmin(), getV2Branches()]);
      machineOptions = ms.map((m) => ({
        id: m.id, code: m.code, nickname: m.nickname, branchId: m.branchId, branchName: m.branchName, isActive: m.isActive,
      }));
      branchOptions = bs.map((b) => ({ id: b.id, name: b.name, code: b.code }));
    }
  } catch {
    // graceful: ยังไม่ login / DB ว่าง → ซ่อนปุ่มย้าย (isAdmin=false)
  }
  try {
    [branchPnl, machineInfo] = await Promise.all([getBranchPnl(), getBranchMachineInfo()]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client จะ fallback เป็นตัวอย่าง
  }

  const branches: BranchRow[] = branchPnl.map((b) => {
    const info = machineInfo?.byBranch.get(b.branchId);
    return {
      branchId: b.branchId,
      code: b.code,
      name: b.name,
      // จำนวนตู้จริง (cfMachine active) — เลิกใช้ proxy riskyMachines+sessions
      machines: info?.count ?? 0,
      dolls: b.dollsOut,
      revenue: b.revenue,
      profit: b.profit,
      avgWin: b.avgBahtPerDoll == null ? 0 : Math.round(b.avgBahtPerDoll),
      flag: b.flag.flag,
      // สถานะรายตู้จริง (good/warn/broken) สำหรับ render dots
      dots: (info?.dots ?? []) as MachineDotStatus[],
    };
  });

  return (
    <BranchesClient
      branches={branches}
      isAdmin={isAdmin}
      machineOptions={machineOptions}
      branchOptions={branchOptions}
    />
  );
}
