/**
 * ตู้คีบ OS — Dashboard (ภาพรวมร้าน)
 * Server: P&L รายสาขา (จริง) + anomaly inbox (จริง). ถ้า DB ว่าง → sample fallback ในฝั่ง client
 * เพื่อไม่ให้หน้าโล่ง (ตาม pattern ClawFleet เดิม).
 */
import { getBranchPnl, summarizeBranchPnl, bangkokRangeLastDays } from "@/lib/clawfleet/pnl-queries";
import { getBranchMachineInfo, getDailyPnl, getDashboardLowStock } from "@/lib/clawfleet/dashboard-queries";
import { getPendingDepositSummary, type PendingSummary } from "@/lib/clawfleet/deposit-queries";
import { loadAnomalies } from "@/lib/clawfleet/loaders";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "@/lib/clawfleet/role-guard";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

/**
 * org นี้มี "ข้อมูลจริง" หรือยัง (เคยเก็บเงินไหม) — scope ด้วย org + สาขาที่ user เห็น
 * (เหมือน loaders อื่น). ใช้ตัดสินว่าจะโชว์ "ตัวอย่าง" (sample) หรือ empty-state จริง.
 * query พัง/ยังไม่ migrate → false (แสดงตัวอย่างได้ · ปลอดภัยกว่าโชว์ empty ปลอม).
 */
async function orgHasAnyRounds(): Promise<boolean> {
  try {
    const session = await requireSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);
    const branchWhere = branchIds === "ALL" ? {} : { branchId: { in: branchIds } };
    const n = await prisma.cfCollectionSession.count({ where: { orgId, ...branchWhere } });
    return n > 0;
  } catch {
    return false;
  }
}

export default async function DashboardPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let anomalies: Awaited<ReturnType<typeof loadAnomalies>> = [];
  let machineInfo: Awaited<ReturnType<typeof getBranchMachineInfo>> | null = null;
  let dailyPnl: Awaited<ReturnType<typeof getDailyPnl>> = [];
  let lowStock: Awaited<ReturnType<typeof getDashboardLowStock>> = [];
  let hasRealData = false;
  // KPI "รายได้ (7 วัน)" ต้องครอบคลุมหน้าต่างเดียวกับกราฟ (7 วันล่าสุด เวลาไทย)
  // ไม่งั้น getBranchPnl() default = วันนี้วันเดียว → KPI ต่ำกว่าที่ควร
  const range7d = bangkokRangeLastDays(7);
  try {
    [branchPnl, anomalies, machineInfo, dailyPnl, lowStock, hasRealData] = await Promise.all([
      getBranchPnl(range7d),
      loadAnomalies("all"),
      getBranchMachineInfo(),
      getDailyPnl(7),
      getDashboardLowStock(6),
      orgHasAnyRounds(),
    ]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → ใช้ sample fallback
  }

  // เงินรอฝาก (custody→deposit) — โหลดแยก try-catch ของตัวเอง เพื่อไม่ให้ query ใหม่นี้
  // ล้ม แล้วลาก dashboard ทั้งหน้าไปด้วย (ตาราง cf_cash_deposit อาจยังไม่ migrate ในบาง env).
  let pendingDeposit: PendingSummary = { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0 };
  try {
    pendingDeposit = await getPendingDepositSummary();
  } catch {
    // graceful: ยังไม่ migrate/DB ว่าง → 0 (การ์ดจะซ่อนเอง ไม่โชว์ตัวเลขปลอม)
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
        // ต้นทุนตุ๊กตาจริง (รวมทุกสาขา) — ใช้คำนวณ "ต้นทุน/ตัว" จริง แทนการเดา
        cost: summary.cost,
        profit: summary.profit,
        dollsOut: summary.dollsOut,
        hasCost: summary.hasCost,
        avgBahtPerDoll: summary.avgBahtPerDoll,
        riskyBranches: summary.riskyBranches,
      }}
      branches={branches}
      alerts={alerts}
      machineCount={fleet.activeMachines}
      dailyPnl={dailyPnl}
      lowStock={lowStock}
      fleet={fleet}
      hasRealData={hasRealData}
      pendingDeposit={pendingDeposit}
    />
  );
}
