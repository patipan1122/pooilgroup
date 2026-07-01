/**
 * ตู้คีบ OS — รายงาน (Reports)
 * Server: P&L รายสาขา (จริง · ใช้ flag/riskyMachines หาตู้ที่มีปัญหา)
 *         + Team data (จริง · staff) + ผลงานต่อคน (จริง · รอบเก็บ/ยอดไม่ตรง จาก getStaffPerformance)
 *         + สินค้าใกล้หมด (จริง · getCfStockOverview ต่อสาขา รวมทุกสาขาในขอบเขต).
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */
import { getBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { getTeamData } from "@/lib/clawfleet/admin-queries";
import { getStaffPerformance, getLowStockItems } from "@/lib/clawfleet/reports-queries";
import { ReportsClient, type ProblemBranch, type StaffQualityRow, type LowStockItem } from "./reports-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let team: Awaited<ReturnType<typeof getTeamData>> | null = null;
  let staffPerf: Awaited<ReturnType<typeof getStaffPerformance>> = new Map();
  let lowStock: LowStockItem[] = [];

  try {
    const [pnl, t, perf, low] = await Promise.all([
      getBranchPnl(),
      getTeamData(),
      getStaffPerformance({ days: 30 }),
      getLowStockItems(6),
    ]);
    branchPnl = pnl;
    team = t;
    staffPerf = perf;
    lowStock = low.map((p) => ({ name: p.name, loc: p.branchName, qty: p.qty, reorderLevel: p.reorderLevel }));
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → sample fallback ในฝั่ง client
  }

  // ── ตู้ที่มีปัญหา: เอาเฉพาะสาขาที่ธงไม่ใช่ "พอดี/ไม่มีข้อมูล" หรือมีตู้เสี่ยง ──
  const problemBranches: ProblemBranch[] = branchPnl
    .filter((b) => b.riskyMachines > 0 || (b.flag.flag !== "GOOD" && b.flag.flag !== "NODATA"))
    .sort((a, b) => b.flag.severity - a.flag.severity || b.riskyMachines - a.riskyMachines)
    .slice(0, 6)
    .map((b) => ({
      branchId: b.branchId,
      name: b.name,
      code: b.code,
      flag: b.flag.flag,
      riskyMachines: b.riskyMachines,
      avgBahtPerDoll: b.avgBahtPerDoll == null ? null : Math.round(b.avgBahtPerDoll),
    }));

  // ── คุณภาพงานพนักงานเก็บเงิน: รวม staff จากทุกสาขา (unique ต่อคน) + เติมผลงานจริง ──
  const seen = new Set<string>();
  const staffQuality: StaffQualityRow[] = [];
  for (const br of team?.branches ?? []) {
    for (const m of br.staff) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const perf = staffPerf.get(m.id);
      staffQuality.push({
        id: m.id,
        name: m.name,
        role: m.role,
        branchName: m.branchName,
        status: m.status,
        rounds: perf?.rounds ?? 0,
        mismatch: perf?.mismatch ?? 0,
      });
    }
  }
  // เรียงคนที่ "ยอดไม่ตรงมากสุด" ขึ้นก่อน (ให้ HQ เห็นคนที่ต้องจับตาบนสุด) แล้วตามด้วยชื่อ
  staffQuality.sort(
    (a, b) => (b.mismatch ?? 0) - (a.mismatch ?? 0) || a.name.localeCompare(b.name, "th"),
  );

  return (
    <ReportsClient problemBranches={problemBranches} staffQuality={staffQuality} lowStock={lowStock} />
  );
}
