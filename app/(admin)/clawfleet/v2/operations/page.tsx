/**
 * ClawFleet v2 — Operations page (server component).
 *
 * Fetches active sessions + anomalies + closed sessions + branches from the
 * real-DB loaders (with graceful mock fallback) and hands them to the
 * `OperationsClient` island. Branch filter comes from the `?branch=`
 * searchParam (a Promise in Next.js 15); loaders pre-scope rows to that branch.
 */

import { OperationsClient } from "./operations-client";
import { loadAnomalies, loadBranches, loadHubData } from "@/lib/clawfleet/v2-loaders";

export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const branch = (await searchParams).branch ?? "all";
  const [hub, anomalies, branches] = await Promise.all([
    loadHubData(branch),
    loadAnomalies(branch),
    loadBranches(),
  ]);

  return (
    <OperationsClient
      branch={branch}
      activeSessions={hub.activeSessions}
      anomalies={anomalies}
      closedToday={hub.closedToday}
      branches={branches}
    />
  );
}
