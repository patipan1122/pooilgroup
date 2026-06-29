/**
 * ตู้คีบ OS — รายงาน (Reports)
 * Server: P&L รายสาขา (จริง · ใช้ flag/riskyMachines หาตู้ที่มีปัญหา)
 *         + Team data (จริง · staff สำหรับคุณภาพงานพนักงานเก็บเงิน).
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 * NOTE: "สินค้าใกล้หมด" ยังเป็น SAMPLE — ดู backend gap ใน briefing.
 */
import { getBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { getTeamData } from "@/lib/clawfleet/admin-queries";
import { ReportsClient, type ProblemBranch, type StaffQualityRow } from "./reports-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let team: Awaited<ReturnType<typeof getTeamData>> | null = null;
  try {
    [branchPnl, team] = await Promise.all([getBranchPnl(), getTeamData()]);
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

  // ── คุณภาพงานพนักงานเก็บเงิน: รวม staff จากทุกสาขา (unique ต่อคน) ──
  // GAP: ยังไม่มี per-staff "รอบเก็บ" / "ยอดไม่ตรง" จริง → ใส่ null, client เติมตัวอย่าง.
  const seen = new Set<string>();
  const staffQuality: StaffQualityRow[] = [];
  for (const br of team?.branches ?? []) {
    for (const m of br.staff) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      staffQuality.push({
        id: m.id,
        name: m.name,
        role: m.role,
        branchName: m.branchName,
        status: m.status,
        rounds: null,
        mismatch: null,
      });
    }
  }

  return (
    <ReportsClient problemBranches={problemBranches} staffQuality={staffQuality} />
  );
}
