/**
 * ตู้คีบ OS — สาขา (Branches)
 * Server: ดึง P&L รายสาขา (จริง) ใน try/catch → ส่งให้ client.
 * ถ้า DB ว่าง/ยังไม่ migrate → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */
import { getBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { BranchesClient, type BranchRow } from "./branches-client";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  try {
    branchPnl = await getBranchPnl();
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client จะ fallback เป็นตัวอย่าง
  }

  const branches: BranchRow[] = branchPnl.map((b) => ({
    branchId: b.branchId,
    code: b.code,
    name: b.name,
    // ไม่มี field "ตู้" ตรง ๆ ใน BranchPnl → ใช้ riskyMachines + sessions เป็น proxy (เหมือน dashboard)
    machines: b.riskyMachines + b.sessions,
    dolls: b.dollsOut,
    revenue: b.revenue,
    profit: b.profit,
    avgWin: b.avgBahtPerDoll == null ? 0 : Math.round(b.avgBahtPerDoll),
    flag: b.flag.flag,
  }));

  return <BranchesClient branches={branches} />;
}
