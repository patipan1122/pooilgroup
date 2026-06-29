/**
 * ตู้คีบ OS — Dashboard (ภาพรวมร้าน)
 * Server: P&L รายสาขา (จริง) + anomaly inbox (จริง). ถ้า DB ว่าง → sample fallback ในฝั่ง client
 * เพื่อไม่ให้หน้าโล่ง (ตาม pattern ClawFleet เดิม).
 */
import { getBranchPnl, summarizeBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { getBranchMachineInfo, getDailyPnl, getDashboardLowStock } from "@/lib/clawfleet/dashboard-queries";
import { loadAnomalies } from "@/lib/clawfleet/loaders";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let anomalies: Awaited<ReturnType<typeof loadAnomalies>> = [];
  let machineInfo: Awaited<ReturnType<typeof getBranchMachineInfo>> | null = null;
  let dailyPnl: Awaited<ReturnType<typeof getDailyPnl>> = [];
  let lowStock: Awaited<ReturnType<typeof getDashboardLowStock>> = [];
  try {
    [branchPnl, anomalies, machineInfo, dailyPnl, lowStock] = await Promise.all([
      getBranchPnl(),
      loadAnomalies("all"),
      getBranchMachineInfo(),
      getDailyPnl(7),
      getDashboardLowStock(6),
    ]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → ใช้ sample fallback
  }
  const summary = summarizeBranchPnl(branchPnl);

  const branches = branchPnl.map((b) => ({
    branchId: b.branchId,
    code: b.code,
    name: b.name,
    // ตู้จริงต่อสาขา (cfMachine active) — ไม่ใช่ proxy riskyMachines+sessions อีกต่อไป
    machines: machineInfo?.byBranch.get(b.branchId)?.count ?? 0,
    dolls: b.dollsOut,
    revenue: b.revenue,
    profit: b.profit,
    avgWin: b.avgBahtPerDoll == null ? 0 : Math.round(b.avgBahtPerDoll),
    flag: b.flag.flag,
  }));

  const fleet = machineInfo?.fleet ?? { totalMachines: 0, activeMachines: 0, needRefill: 0, broken: 0 };

  const alerts = anomalies.slice(0, 6).map((a) => ({
    title: a.typeLabel || a.reason || "ยอดไม่ตรง",
    detail: `${a.branchName ?? a.branchCode ?? "สาขา"} · ${a.machineName ?? ""} · ${a.timeAgo ?? ""}`.replace(/ · $/, ""),
    tag: a.severity,
    tone: (a.severity === "P0" ? "red" : a.severity === "P1" ? "amber" : "neutral") as "red" | "amber" | "neutral",
  }));

  return (
    <DashboardClient
      summary={{
        revenue: summary.revenue,
        profit: summary.profit,
        dollsOut: summary.dollsOut,
        avgBahtPerDoll: summary.avgBahtPerDoll,
        riskyBranches: summary.riskyBranches,
      }}
      branches={branches}
      alerts={alerts}
      machineCount={fleet.activeMachines}
      dailyPnl={dailyPnl}
      lowStock={lowStock}
      fleet={fleet}
    />
  );
}
