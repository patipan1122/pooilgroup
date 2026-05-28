/**
 * ClawFleet v2 — Stock page (per-branch warehouse + in-machine + central deliveries).
 *
 * Server component: fetches every branch's stock + deliveries from the v2
 * loaders (real DB with graceful mock fallback) and hands them to the
 * `StockClient` island. Because the branch-chip selector switches branches
 * client-side, we pre-fetch all branches' stock into a `Record<branchId, …>`
 * so switching is instant with no extra round-trip. Visual output is identical
 * to the prior mock-data version.
 */

import { loadBranches, loadBranchStock } from "@/lib/clawfleet/v2-loaders";
import type { Delivery, StockEntry } from "@/lib/clawfleet/v2-data";
import { StockClient } from "./stock-client";

export const dynamic = "force-dynamic";

export type BranchStock = { stock: StockEntry[]; deliveries: Delivery[] };

export default async function StockPage() {
  const branches = await loadBranches();
  const first = branches[0]?.id ?? "";

  const entries = await Promise.all(
    branches.map(async (b): Promise<[string, BranchStock]> => [b.id, await loadBranchStock(b.id)]),
  );
  const stockByBranch: Record<string, BranchStock> = Object.fromEntries(entries);

  return (
    <StockClient branches={branches} initialBranchId={first} stockByBranch={stockByBranch} />
  );
}
