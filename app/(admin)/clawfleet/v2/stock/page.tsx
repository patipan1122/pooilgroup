/**
 * ClawFleet v2 — Stock hub (back-office WMS).
 *
 * Tabbed hub (ภาพรวม / สินค้าในคลัง / ใบรับสินค้า / นับสต๊อก / ของหาย / ประวัติ),
 * forked from Playland's stock page pattern but re-styled with the cf- design
 * system. Stock is ledger-derived (sum of signed qty in cf_stock_movements).
 *
 * Server component: resolves the active branch + pre-loads all WMS data for it,
 * hands everything to the `StockHubClient` island which owns tab + form state.
 */

import { loadBranches } from "@/lib/clawfleet/v2-loaders";
import { requireSession } from "@/lib/auth/session";
import {
  getCfStockOverview,
  getCfBranchStockProducts,
  getCfReceipts,
  getCfCounts,
  getCfLosses,
  getCfMovements,
  getCfProductsForForms,
} from "@/lib/clawfleet/stock-queries";
import { StockHubClient } from "./stock-hub-client";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; tab?: string }>;
}) {
  const { branch, tab } = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await loadBranches();

  const requested = branch && branches.some((b) => b.id === branch) ? branch : null;
  const activeBranchId = requested ?? branches[0]?.id ?? "";

  // Pre-load every WMS dataset for the active branch (one round of queries).
  const [overview, products, receipts, counts, losses, movements, formProducts] =
    activeBranchId
      ? await Promise.all([
          getCfStockOverview(orgId, activeBranchId),
          getCfBranchStockProducts(orgId, activeBranchId),
          getCfReceipts(orgId, activeBranchId),
          getCfCounts(orgId, activeBranchId),
          getCfLosses(orgId, activeBranchId),
          getCfMovements(orgId, activeBranchId, 100),
          getCfProductsForForms(orgId),
        ])
      : [
          { lowCount: 0, skuCount: 0, inventoryValueCents: 0, recentMovements: [], lowProducts: [] },
          [],
          [],
          [],
          [],
          [],
          [],
        ];

  return (
    <StockHubClient
      branches={branches}
      activeBranchId={activeBranchId}
      initialTab={tab ?? "overview"}
      data={{ overview, products, receipts, counts, losses, movements, formProducts }}
    />
  );
}
