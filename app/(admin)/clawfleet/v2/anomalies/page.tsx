/**
 * ClawFleet v2 — Anomaly Inbox page (server component).
 *
 * Fetches anomalies + branches from the real-DB loaders (with graceful mock
 * fallback) and hands them to the `AnomaliesClient` island. Branch filter comes
 * from the `?branch=` searchParam (a Promise in Next.js 15).
 */

import { AnomaliesClient } from "./anomalies-client";
import { loadAnomalies, loadBranches } from "@/lib/clawfleet/v2-loaders";

export const dynamic = "force-dynamic";

export default async function AnomalyInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const branch = (await searchParams).branch ?? "all";
  const [anomalies, branches] = await Promise.all([loadAnomalies(branch), loadBranches()]);

  return <AnomaliesClient branch={branch} anomalies={anomalies} branches={branches} />;
}
