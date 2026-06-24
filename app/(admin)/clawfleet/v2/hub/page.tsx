/**
 * ClawFleet v2 — Hub page = แดชบอร์ดกำไร/ขาดทุน ("วันนี้กำไรเท่าไหร่ · ตู้ไหนเสี่ยง")
 *
 * Server component: ดึง P&L รายสาขา (pnl-queries) + Anomaly inbox + รอบที่กำลังเดิน,
 * แล้วส่งให้ HubClient island เรนเดอร์. ตัวชี้วัดหลัก = ค่าเฉลี่ยบาท/ตุ๊กตา 1 ตัว.
 */

import { loadHubData, loadAnomalies } from "@/lib/clawfleet/v2-loaders";
import { getBranchPnl, summarizeBranchPnl } from "@/lib/clawfleet/pnl-queries";
import { HubClient } from "./hub-client";

export const dynamic = "force-dynamic";

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const branch = (await searchParams).branch ?? "all";
  const [branchPnl, hub, anomalies] = await Promise.all([
    getBranchPnl(),
    loadHubData(branch),
    loadAnomalies(branch),
  ]);
  const summary = summarizeBranchPnl(branchPnl);

  return (
    <HubClient
      branch={branch}
      branchPnl={branchPnl}
      summary={summary}
      hub={hub}
      anomalies={anomalies}
    />
  );
}
