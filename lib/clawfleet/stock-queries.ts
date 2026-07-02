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
  // Wave 4b maker-checker: สถานะ + คนนับ/คนอนุมัติ (สำหรับ pill + self-approve gate)
  status: string; // APPLIED | PENDING | APPROVED | REJECTED
  countedById: string;
  reviewedByName: string | null;
};

export async function getCfCounts(orgId: string, branchId: string): Promise<CfCountRow[]> {
  const rows = await prisma.cfStockCount.findMany({
    where: { orgId, branchId },
    orderBy: { countedAt: "desc" },
    take: 50,
    select: {
      id: true, countCode: true, countedByName: true, note: true,
      itemsCounted: true, totalDiff: true, countedAt: true,
      status: true, countedById: true, reviewedByName: true,
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

/**
 * มูลค่าสต๊อก "ณ วันปิดงวด" (as-of) — เดินตาม ledger จริง แทนที่จะใช้ต้นทุนปัจจุบันคูณยอดปัจจุบัน.
 * ปัญหาเดิม: inventoryValueCents ใช้ cfProduct.unitCostCents (ต้นทุนเฉลี่ย "วันนี้") ซึ่งเปลี่ยนทุกครั้ง
 *   ที่รับของใหม่ → มูลค่าย้อนหลังเพี้ยน (คิดของเก่าด้วยราคาวันนี้). งบการเงินต้องการมูลค่า ณ วันปิดจริง.
 * วิธี: เดิน movement ทุกตัวถึง occurredAt ≤ asOf (จบวันนั้น) เรียงตามเวลา · เก็บ running balance ต่อ product
 *   และ "ต้นทุนต่อชิ้น ณ ตอนนั้น" จาก movement ที่เพิ่มของเข้า (qty>0 · unitCostCents>0) — mirror
 *   ต้นทุนเฉลี่ยถ่วงน้ำหนักแบบง่าย (ของเข้าคิดต้นทุนของ movement นั้น · ของออกคิดต้นทุนเฉลี่ยที่ถืออยู่).
 * คืน มูลค่ารวม (สตางค์) = Σ (balance ต่อ product × ต้นทุนเฉลี่ย ณ asOf).
 */
export async function getCfInventoryValueAsOf(
  orgId: string,
  branchId: string,
  asOf: Date,
): Promise<number> {
  // จบวันของ asOf (รวมทั้งวัน) — ปิดงวด ณ สิ้นวันนั้น
  const cutoff = new Date(asOf);
  cutoff.setHours(23, 59, 59, 999);

  const moves = await prisma.cfStockMovement.findMany({
    where: { orgId, branchId, occurredAt: { lte: cutoff } },
    select: { productId: true, qty: true, unitCostCents: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  // running weighted-avg ต่อ product: qty คงเหลือ + costPerUnit ที่ถืออยู่ (สตางค์)
  const state = new Map<string, { qty: number; cost: number }>();
  for (const m of moves) {
    const cur = state.get(m.productId) ?? { qty: 0, cost: 0 };
    if (m.qty > 0) {
      // ของเข้า — ถ้า movement มีต้นทุน (>0) ใช้ต้นทุนนั้นถ่วงเฉลี่ย · ถ้าไม่มี คงต้นทุนเดิมไว้
      const inCost = m.unitCostCents > 0 ? m.unitCostCents : cur.cost;
      const newQty = cur.qty + m.qty;
      cur.cost = newQty > 0
        ? Math.round((cur.qty * cur.cost + m.qty * inCost) / newQty)
        : inCost;
      cur.qty = newQty;
    } else {
      // ของออก — ลดจำนวน · ต้นทุนต่อชิ้นคงเดิม (คิดของออกด้วยต้นทุนเฉลี่ยที่ถืออยู่)
      cur.qty += m.qty; // qty เป็นลบ
      if (cur.qty <= 0) { cur.qty = 0; cur.cost = 0; }
    }
    state.set(m.productId, cur);
  }

  let total = 0;
  for (const s of state.values()) {
    if (s.qty > 0) total += s.qty * s.cost;
  }
  return total;
}

/** สรุปภาพรวม KPI สำหรับแท็บภาพรวม · asOf (optional) = คิดมูลค่าสต๊อก ณ วันปิดงวดจาก ledger */
export async function getCfStockOverview(
  orgId: string,
  branchId: string,
  asOf?: Date,
): Promise<{
  lowCount: number;
  skuCount: number;
  inventoryValueCents: number;
  inventoryValueAsOf: Date | null;
  recentMovements: CfMovementRow[];
  lowProducts: CfStockProductRow[];
}> {
  const products = await getCfBranchStockProducts(orgId, branchId);
  const lowProducts = products.filter((p) => p.warehouse <= p.reorderLevel);
  // มูลค่าปัจจุบัน = ต้นทุนเฉลี่ยวันนี้ × ยอดปัจจุบัน · ถ้ามี asOf → เดิน ledger ตามต้นทุน ณ วันนั้น
  const inventoryValueCents = asOf
    ? await getCfInventoryValueAsOf(orgId, branchId, asOf)
    : products.reduce((s, p) => s + (p.warehouse + p.inMachines) * p.unitCostCents, 0);
  const recentMovements = await getCfMovements(orgId, branchId, 8);
  return {
    lowCount: lowProducts.length,
    skuCount: products.length,
    inventoryValueCents,
    inventoryValueAsOf: asOf ?? null,
    recentMovements,
    lowProducts,
  };
}

/**
 * ยอด "ระบบมี" ต่อสินค้าในคลังสาขา (warehouse · machineId null) — สำหรับฟอร์มนับสต๊อก
 * โชว์ยอดระบบข้าง ๆ ช่องนับ (กันนับตาบอด). คืน map productId → คงเหลือคลัง (อาจ 0/ติดลบถ้าเพี้ยน).
 */
export async function getCfBranchOnHandMap(
  orgId: string,
  branchId: string,
): Promise<Record<string, number>> {
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, branchId, machineId: null },
    _sum: { qty: true },
  });
  const out: Record<string, number> = {};
  for (const m of moves) out[m.productId] = m._sum.qty ?? 0;
  return out;
}

/** สินค้าทั้งหมดของ org (สำหรับ dropdown ในฟอร์มรับเข้า/นับ/ของหาย) */
export async function getCfProductsForForms(orgId: string): Promise<Array<{ id: string; sku: string; barcode: string | null; name: string; unitCostCents: number }>> {
  return prisma.cfProduct.findMany({
    where: { orgId, isActive: true },
    select: { id: true, sku: true, barcode: true, name: true, unitCostCents: true },
    orderBy: { name: "asc" },
  });
}
