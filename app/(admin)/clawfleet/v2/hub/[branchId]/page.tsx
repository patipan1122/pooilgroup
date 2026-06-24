/**
 * ClawFleet v2 — Branch drill-in (กดลึกเข้าสาขา)
 *
 * แสดง P&L รายตู้ + "ตั้งค่าล่าสุดเมื่อไหร่" + "ใครเก็บล่าสุด" + ประวัติการเก็บ.
 * ตู้ที่ flag LOW/HIGH/LOSS = ไฮไลต์แดง พร้อมคำเตือน "ควรโทรบอกพนักงานตั้งค่าตู้ใหม่".
 */

import { notFound } from "next/navigation";
import {
  getBranchPnl,
  getMachinePnl,
  getBranchSessionHistory,
} from "@/lib/clawfleet/pnl-queries";
import { BranchDrillClient } from "./branch-client";

export const dynamic = "force-dynamic";

export default async function BranchDrillPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const { branchId } = await params;

  const [machinePnl, allBranches, history] = await Promise.all([
    getMachinePnl(branchId),
    getBranchPnl(),
    getBranchSessionHistory(branchId),
  ]);

  if (!machinePnl.branch) notFound();

  const branchSummary = allBranches.find((b) => b.branchId === branchId) ?? null;

  return (
    <BranchDrillClient
      branch={machinePnl.branch}
      summary={branchSummary}
      machines={machinePnl.machines}
      history={history}
    />
  );
}
