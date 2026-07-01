// ClawFleet · Stock WMS read-side — โหลดข้อมูลให้แท็บคลังสินค้า (server-only)
// สต๊อกปัจจุบัน = ผลรวม signed qty ใน cf_stock_movements (ledger-derived · ไม่มีคอลัมน์ stock)

import { prisma } from "@/lib/prisma";

export type CfStockProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unitCostCents: number;
  warehouse: number; // คงคลังสาขา (ไม่รวมในตู้)
  inMachines: number; // อยู่ในตู้
  reorderLevel: number; // เกณฑ์เตือนใกล้หมด (cf ไม่มี field → ค่าคงที่)
};

const CF_REORDER_LEVEL = 8; // ClawFleet ไม่มี reorderLevel ต่อ product → ใช้เกณฑ์รวม

/** สต๊อกรายสินค้าในสาขา — แยก warehouse (ไม่ใช่ในตู้) กับ inMachines (machineId != null) */
export async function getCfBranchStockProducts(
  orgId: string,
  branchId: string,
): Promise<CfStockProductRow[]> {
  const products = await prisma.cfProduct.findMany({
    where: { orgId, isActive: true },
    select: { id: true, sku: true, barcode: true, name: true, category: true, unitCostCents: true },
    orderBy: { name: "asc" },
  });
  if (products.length === 0) return [];

  // ผลรวม qty ต่อ product — แยกเป็น "ในตู้" (machineId != null) กับ "คลังสาขา" (machineId null)
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, branchId, machineId: null },
    _sum: { qty: true },
  });
  const inMachineMoves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, branchId, machineId: { not: null } },
    _sum: { qty: true },
  });
  const whMap = new Map(moves.map((m) => [m.productId, m._sum.qty ?? 0]));
  const imMap = new Map(inMachineMoves.map((m) => [m.productId, m._sum.qty ?? 0]));

  return products
    .map((p): CfStockProductRow => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category: p.category,
      unitCostCents: p.unitCostCents,
      warehouse: whMap.get(p.id) ?? 0,
      // ในตู้ = − (movement ของ LOAD_TO_MACHINE ที่ machineId != null) → ทำให้เป็นบวก
      inMachines: Math.abs(imMap.get(p.id) ?? 0),
      reorderLevel: CF_REORDER_LEVEL,
    }))
    // โชว์เฉพาะที่มีความเคลื่อนไหวหรือมีของ (กันแสดงสินค้าทุกตัวของ org ที่ไม่เคยรับเข้าสาขานี้)
    .filter((r) => r.warehouse !== 0 || r.inMachines !== 0);
}

export type CfReceiptRow = {
  id: string;
  receiptCode: string;
  supplierName: string | null;
  note: string | null;
  totalCostCents: number;
  itemsCount: number;
  photoCount: number;
  createdAt: Date;
};

export async function getCfReceipts(orgId: string, branchId: string): Promise<CfReceiptRow[]> {
  const rows = await prisma.cfGoodsReceipt.findMany({
    where: { orgId, branchId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    receiptCode: r.receiptCode,
    supplierName: r.supplierName,
    note: r.note,
    totalCostCents: r.totalCostCents,
    itemsCount: r._count.lines,
    photoCount: r.photoUrls.length,
    createdAt: r.createdAt,
  }));
}

export type CfCountRow = {
  id: string;
  countCode: string;
  countedByName: string | null;
  note: string | null;
  itemsCounted: number;
  totalDiff: number;
  countedAt: Date;
};

export async function getCfCounts(orgId: string, branchId: string): Promise<CfCountRow[]> {
  const rows = await prisma.cfStockCount.findMany({
    where: { orgId, branchId },
    orderBy: { countedAt: "desc" },
    take: 50,
    select: {
      id: true, countCode: true, countedByName: true, note: true,
      itemsCounted: true, totalDiff: true, countedAt: true,
    },
  });
  return rows;
}

export type CfLossRow = {
  id: string;
  lossCode: string;
  reason: string;
  note: string | null;
  totalCostCents: number;
  itemsCount: number;
  photoCount: number;
  reportedAt: Date;
  // D1 maker-checker (audit 2026-07-01): สถานะอนุมัติ + คนแจ้ง/คนอนุมัติ (สำหรับ pill + self-approve gate)
  status: string; // PENDING | APPROVED | REJECTED
  reportedById: string;
  reviewedByName: string | null;
};

export async function getCfLosses(orgId: string, branchId: string): Promise<CfLossRow[]> {
  const rows = await prisma.cfLossDoc.findMany({
    where: { orgId, branchId },
    orderBy: { reportedAt: "desc" },
    take: 50,
    include: { _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    lossCode: r.lossCode,
    reason: r.reason,
    note: r.note,
    totalCostCents: r.totalCostCents,
    itemsCount: r._count.lines,
    photoCount: r.photoUrls.length,
    reportedAt: r.reportedAt,
    status: r.status,
    reportedById: r.reportedById,
    reviewedByName: r.reviewedByName,
  }));
}

export type CfMovementRow = {
  id: string;
  type: string;
  productName: string;
  qty: number;
  reason: string | null;
  documentType: string | null;
  occurredAt: Date;
};

export async function getCfMovements(orgId: string, branchId: string, limit = 100): Promise<CfMovementRow[]> {
  const rows = await prisma.cfStockMovement.findMany({
    where: { orgId, branchId },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: { product: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    type: m.type,
    productName: m.product.name,
    qty: m.qty,
    reason: m.reason,
    documentType: m.documentType,
    occurredAt: m.occurredAt,
  }));
}

/** สรุปภาพรวม KPI สำหรับแท็บภาพรวม */
export async function getCfStockOverview(orgId: string, branchId: string): Promise<{
  lowCount: number;
  skuCount: number;
  inventoryValueCents: number;
  recentMovements: CfMovementRow[];
  lowProducts: CfStockProductRow[];
}> {
  const products = await getCfBranchStockProducts(orgId, branchId);
  const lowProducts = products.filter((p) => p.warehouse <= p.reorderLevel);
  const inventoryValueCents = products.reduce((s, p) => s + (p.warehouse + p.inMachines) * p.unitCostCents, 0);
  const recentMovements = await getCfMovements(orgId, branchId, 8);
  return {
    lowCount: lowProducts.length,
    skuCount: products.length,
    inventoryValueCents,
    recentMovements,
    lowProducts,
  };
}

/** สินค้าทั้งหมดของ org (สำหรับ dropdown ในฟอร์มรับเข้า/นับ/ของหาย) */
export async function getCfProductsForForms(orgId: string): Promise<Array<{ id: string; sku: string; barcode: string | null; name: string; unitCostCents: number }>> {
  return prisma.cfProduct.findMany({
    where: { orgId, isActive: true },
    select: { id: true, sku: true, barcode: true, name: true, unitCostCents: true },
    orderBy: { name: "asc" },
  });
}
