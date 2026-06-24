// DC Warehouse · REPORT helpers (server-only · plain async fns, NOT "use server").
//
// ★ ARCHITECTURE (locked — read the prompt's ARCHITECTURE block):
//   DC carries ONLY physical qty + location. It has NO cost column on the balance.
//   The AUTHORITATIVE inventory *value* lives in TRCloud (the financial book).
//   So every "มูลค่า" we surface here is an ESTIMATE:
//       estValue = Σ( onHand × latestLandedUnitSatang )
//   where latestLandedUnitSatang = the product's MOST RECENT DcCostLayer.landedUnitSatang
//   (fallback: latest RECEIVE movement's unitCostSatang, else 0).
//   Always label it "ประมาณการจากต้นทุนนำเข้าล่าสุด · มูลค่าจริงดูที่บัญชี (TRCloud)".
//   DC = truth for physical availability; TRCloud = truth for book value.
//   The gap between the two is the cycle-count signal — never paper over it.
//
// These are PLAIN async functions called by server pages (no "use server").
// Each takes orgId (and optional allowed-warehouse scoping) so a page can pass
// the caller's getAllowedWarehouses() result straight through.

import { prisma } from "@/lib/prisma";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import { MOVE_KIND_LABEL, PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";

// ── latest landed unit cost (satang) per product ──────────────────────────────
//
// Build one map for a set of products: most-recent DcCostLayer.landedUnitSatang;
// if a product has no cost layer, fall back to its latest RECEIVE movement's
// unitCostSatang; else 0. Done in 2 bulk queries (no N+1).
export async function buildLatestLandedUnitMap(
  orgId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;

  // Most recent cost layer per product. Pull newest-first, keep the first seen.
  const layers = await prisma.dcCostLayer.findMany({
    where: { orgId, productId: { in: productIds } },
    orderBy: { createdAt: "desc" },
    select: { productId: true, landedUnitSatang: true },
  });
  for (const l of layers) {
    if (!map.has(l.productId)) map.set(l.productId, l.landedUnitSatang);
  }

  // Fallback: latest RECEIVE movement with a non-null unit cost, for products
  // that still have no value.
  const missing = productIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const moves = await prisma.dcStockMovement.findMany({
      where: {
        orgId,
        productId: { in: missing },
        kind: DcMoveKind.RECEIVE,
        unitCostSatang: { not: null },
      },
      orderBy: { occurredAt: "desc" },
      select: { productId: true, unitCostSatang: true },
    });
    for (const m of moves) {
      if (!map.has(m.productId) && m.unitCostSatang != null) {
        map.set(m.productId, m.unitCostSatang);
      }
    }
  }

  // Everything else → 0 (no known import cost yet).
  for (const id of productIds) if (!map.has(id)) map.set(id, 0);
  return map;
}

// Shared helper: WHERE clause that respects an optional allowed-warehouse scope.
function whScope(orgId: string, allowed?: string[] | null) {
  const base: { orgId: string; warehouseId?: { in: string[] } } = { orgId };
  if (allowed && allowed.length > 0) base.warehouseId = { in: allowed };
  return base;
}

// ── 1) OVERVIEW KPIs ──────────────────────────────────────────────────────────
export type DcOverview = {
  totalSkus: number;
  totalUnits: number; // Σ onHand
  estValueSatang: number; // Σ onHand × latestLandedUnit (ประมาณการ)
  lowStockCount: number; // onHand < reorderPoint & reorderPoint > 0
  inTransitUnits: number; // Σ qtyInTransit
  pendingTrcloud: number; // GRN postStatus PENDING/FAILED count
  warehouseCount: number;
};

export async function getDcOverview(
  orgId: string,
  allowedWarehouseIds?: string[] | null,
): Promise<DcOverview> {
  const where = whScope(orgId, allowedWarehouseIds);

  const [balances, products, warehouseCount, pendingTrcloud] = await Promise.all([
    prisma.dcStockBalance.findMany({
      where,
      select: { productId: true, qtyOnHand: true, qtyInTransit: true },
    }),
    prisma.dcProduct.findMany({
      where: { orgId, active: true },
      select: { id: true, reorderPoint: true },
    }),
    prisma.dcWarehouse.count({
      where: {
        orgId,
        isActive: true,
        ...(allowedWarehouseIds && allowedWarehouseIds.length > 0
          ? { id: { in: allowedWarehouseIds } }
          : {}),
      },
    }),
    prisma.dcGoodsReceipt.count({
      where: { orgId, postStatus: { in: ["PENDING", "FAILED"] } },
    }),
  ]);

  // SKUs that actually hold stock somewhere in the allowed scope.
  const skuSet = new Set<string>();
  let totalUnits = 0;
  let inTransitUnits = 0;
  // onHand per product, aggregated across warehouses (for est value + low stock).
  const onHandByProduct = new Map<string, number>();
  for (const b of balances) {
    if (b.qtyOnHand > 0) skuSet.add(b.productId);
    totalUnits += b.qtyOnHand;
    inTransitUnits += b.qtyInTransit;
    onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
  }

  // Estimated value — Σ onHand × latest landed unit (per product, summed across whs).
  const productIds = [...onHandByProduct.keys()];
  const landedMap = await buildLatestLandedUnitMap(orgId, productIds);
  let estValueSatang = 0;
  for (const [pid, qty] of onHandByProduct) {
    estValueSatang += qty * (landedMap.get(pid) ?? 0);
  }

  // Low stock — onHand (total in scope) < reorderPoint, reorderPoint > 0.
  const reorderById = new Map(products.map((p) => [p.id, p.reorderPoint ?? 0]));
  let lowStockCount = 0;
  for (const [pid, qty] of onHandByProduct) {
    const rp = reorderById.get(pid) ?? 0;
    if (rp > 0 && qty < rp) lowStockCount++;
  }

  return {
    totalSkus: skuSet.size,
    totalUnits,
    estValueSatang,
    lowStockCount,
    inTransitUnits,
    pendingTrcloud,
    warehouseCount,
  };
}

// ── 2) LOW STOCK list ───────────────────────────────────────────────────────
export type LowStockRow = {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
  warehouseName: string;
};

export async function getLowStock(
  orgId: string,
  allowedWarehouseIds?: string[] | null,
): Promise<LowStockRow[]> {
  const where = whScope(orgId, allowedWarehouseIds);

  const balances = await prisma.dcStockBalance.findMany({
    where,
    select: {
      productId: true,
      qtyOnHand: true,
      warehouse: { select: { name: true } },
      product: { select: { name: true, sku: true, reorderPoint: true, active: true } },
    },
    orderBy: { qtyOnHand: "asc" },
  });

  const rows: LowStockRow[] = [];
  for (const b of balances) {
    if (!b.product.active) continue;
    const rp = b.product.reorderPoint ?? 0;
    if (rp > 0 && b.qtyOnHand < rp) {
      rows.push({
        productId: b.productId,
        name: b.product.name,
        sku: b.product.sku,
        onHand: b.qtyOnHand,
        reorderPoint: rp,
        warehouseName: b.warehouse.name,
      });
    }
  }
  // Most-urgent first: smallest remaining-vs-reorder ratio.
  rows.sort((a, b) => a.onHand / a.reorderPoint - b.onHand / b.reorderPoint);
  return rows;
}

// ── 3) STOCK BY WAREHOUSE (per-product table for one warehouse) ───────────────
export type StockByWarehouseRow = {
  productId: string;
  name: string;
  sku: string;
  type: string; // PRODUCT_TYPE_LABEL value
  onHand: number;
  inTransit: number;
  location: string | null;
  landedUnitSatang: number; // estimate basis
  estValueSatang: number; // onHand × landedUnit
};

export async function getStockByWarehouse(
  orgId: string,
  warehouseId: string,
): Promise<StockByWarehouseRow[]> {
  const balances = await prisma.dcStockBalance.findMany({
    where: { orgId, warehouseId },
    select: {
      productId: true,
      qtyOnHand: true,
      qtyInTransit: true,
      location: true,
      product: { select: { name: true, sku: true, type: true, active: true } },
    },
  });

  const productIds = balances.map((b) => b.productId);
  const landedMap = await buildLatestLandedUnitMap(orgId, productIds);

  const rows: StockByWarehouseRow[] = balances
    .filter((b) => b.product.active)
    .map((b) => {
      const unit = landedMap.get(b.productId) ?? 0;
      return {
        productId: b.productId,
        name: b.product.name,
        sku: b.product.sku,
        type: PRODUCT_TYPE_LABEL[b.product.type] ?? b.product.type,
        onHand: b.qtyOnHand,
        inTransit: b.qtyInTransit,
        location: b.location,
        landedUnitSatang: unit,
        estValueSatang: b.qtyOnHand * unit,
      };
    });

  rows.sort((a, b) => b.estValueSatang - a.estValueSatang || a.name.localeCompare(b.name, "th"));
  return rows;
}

// ── 4) RECENT MOVEMENTS (ledger) ──────────────────────────────────────────────
export type MovementRow = {
  id: string;
  occurredAt: Date;
  kind: string; // raw enum
  kindLabel: string;
  qty: number;
  balanceAfter: number | null;
  productName: string;
  sku: string;
  warehouseName: string;
  actorName: string | null;
  note: string | null;
};

export async function getRecentMovements(
  orgId: string,
  opts?: { warehouseId?: string; limit?: number },
): Promise<MovementRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const moves = await prisma.dcStockMovement.findMany({
    where: { orgId, ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      occurredAt: true,
      kind: true,
      qty: true,
      balanceAfter: true,
      note: true,
      actorUserId: true,
      product: { select: { name: true, sku: true } },
      warehouse: { select: { name: true } },
    },
  });

  // Resolve actor names in one round-trip (movements store actorUserId only).
  const actorIds = [...new Set(moves.map((m) => m.actorUserId).filter((x): x is string => !!x))];
  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    for (const u of users) actorMap.set(u.id, u.name);
  }

  return moves.map((m) => ({
    id: m.id,
    occurredAt: m.occurredAt,
    kind: m.kind,
    kindLabel: MOVE_KIND_LABEL[m.kind] ?? m.kind,
    qty: m.qty,
    balanceAfter: m.balanceAfter,
    productName: m.product.name,
    sku: m.product.sku,
    warehouseName: m.warehouse.name,
    actorName: m.actorUserId ? actorMap.get(m.actorUserId) ?? null : null,
    note: m.note,
  }));
}

// ── 5) LANDED-COST report (recent cost layers w/ breakdown) ───────────────────
export type LandedCostRow = {
  id: string;
  createdAt: Date;
  productName: string;
  sku: string;
  qty: number;
  landedUnitSatang: number;
  goodsThbSatang: number;
  dutyThbSatang: number;
  freightThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  otherThbSatang: number;
  landedTotalSatang: number;
  vatClaimableSatang: number;
  grnCode: string | null;
};

export async function getLandedCostReport(
  orgId: string,
  opts?: { limit?: number },
): Promise<LandedCostRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const layers = await prisma.dcCostLayer.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      qty: true,
      landedUnitSatang: true,
      goodsThbSatang: true,
      dutyThbSatang: true,
      freightThbSatang: true,
      brokerThbSatang: true,
      insuranceThbSatang: true,
      otherThbSatang: true,
      vatClaimableSatang: true,
      product: { select: { name: true, sku: true } },
      grn: { select: { grnCode: true } },
    },
  });

  return layers.map((l) => {
    const landedTotal =
      l.goodsThbSatang +
      l.dutyThbSatang +
      l.freightThbSatang +
      l.brokerThbSatang +
      l.insuranceThbSatang +
      l.otherThbSatang;
    return {
      id: l.id,
      createdAt: l.createdAt,
      productName: l.product.name,
      sku: l.product.sku,
      qty: l.qty,
      landedUnitSatang: l.landedUnitSatang,
      goodsThbSatang: l.goodsThbSatang,
      dutyThbSatang: l.dutyThbSatang,
      freightThbSatang: l.freightThbSatang,
      brokerThbSatang: l.brokerThbSatang,
      insuranceThbSatang: l.insuranceThbSatang,
      otherThbSatang: l.otherThbSatang,
      landedTotalSatang: landedTotal,
      vatClaimableSatang: l.vatClaimableSatang,
      grnCode: l.grn?.grnCode ?? null,
    };
  });
}

// ── money formatter (satang Int → ฿ string) ───────────────────────────────────
export function fmtSatang(satang: number): string {
  return (
    "฿" +
    (satang / 100).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Standard label for every estimated DC value (per the locked architecture). */
export const EST_VALUE_NOTE =
  "ประมาณการจากต้นทุนนำเข้าล่าสุด · มูลค่าจริงดูที่บัญชี (TRCloud)";
