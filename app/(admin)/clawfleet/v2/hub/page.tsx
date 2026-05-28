/**
 * ClawFleet v2 — Hub page ("ตอนนี้คุณต้องทำอะไร")
 *
 * Server component: fetches real-DB data (with graceful mock fallback) via the
 * v2 loaders, then hands it to the `HubClient` island for rendering +
 * interactivity. The visual output is identical to the prior mock-data version.
 */

import { loadHubData, loadAnomalies, loadBranches } from "@/lib/clawfleet/v2-loaders";
import { HubClient } from "./hub-client";

export const dynamic = "force-dynamic";

export default async function HubPage({
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
  return <HubClient branch={branch} hub={hub} anomalies={anomalies} branches={branches} />;
}
