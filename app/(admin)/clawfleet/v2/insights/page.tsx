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
  // Accept the 7/30/90 presets AND any custom day-count from the date picker
  // (insights-client applyCustom navigates with an arbitrary ?days=N). Clamp 1–365.
  const rawDays = Number(sp.days);
  const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(365, Math.floor(rawDays)) : 7;
  const [rows, branches] = await Promise.all([loadInsights(branch, days), loadBranches()]);
  return <InsightsClient branch={branch} rows={rows} branches={branches} days={days} />;
}
