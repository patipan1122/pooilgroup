/**
 * ClawFleet v2 — Insights page.
 *
 * Server component: reads the `?branch=` searchParam, fetches the insight rows
 * (real DB with graceful mock fallback) + branch list via the v2 loaders, then
 * hands them to the `InsightsClient` island. Visual output is identical to the
 * prior mock-data version.
 */

import { loadInsights, loadBranches } from "@/lib/clawfleet/v2-loaders";
import { InsightsClient } from "./insights-client";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const branch = sp.branch ?? "all";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const [rows, branches] = await Promise.all([loadInsights(branch, days), loadBranches()]);
  return <InsightsClient branch={branch} rows={rows} branches={branches} days={days} />;
}
