/**
 * ตู้คีบ OS — สาขา (Branches)
 * Server: ดึง P&L รายสาขา (จริง) ใน try/catch → ส่งให้ client.
 * ถ้า DB ว่าง/ยังไม่ migrate → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */
import { getBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { getBranchMachineInfo, type MachineDotStatus } from "@/lib/clawfleet/dashboard-queries";
import { BranchesClient, type BranchRow } from "./branches-client";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let machineInfo: Awaited<ReturnType<typeof getBranchMachineInfo>> | null = null;
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

  return <BranchesClient branches={branches} />;
}
