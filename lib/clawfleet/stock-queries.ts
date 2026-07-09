// ClawFleet · Stock WMS read-side — โหลดข้อมูลให้แท็บคลังสินค้า (server-only)
// สต๊อกปัจจุบัน = ผลรวม signed qty ใน cf_stock_movements (ledger-derived · ไม่มีคอลัมน์ stock)

import { prisma } from "@/lib/prisma";
import { requireCfSession, userBranchIds } from "./role-guard";

export type CfStockProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  imageUrl: string | null; // รูปสินค้า (R2 · สำหรับ picker/การ์ดในมือถือ)
  unitCostCents: number;
  warehouse: number; // คงคลังสาขา (ไม่รวมในตู้)
  inMachines: number; // อยู่ในตู้
  reorderLevel: number; // เกณฑ์เตือนใกล้หมด (cf ไม่มี field → ค่าคงที่)
};

const CF_REORDER_LEVEL = 8; // ClawFleet ไม่มี reorderLevel ต่อ product → ใช้เกณฑ์รวม

// =============================================================
// Warehouse (คลังหลายห้องต่อสาขา) — bigfeature 2026-07-09
//   SAFETY INVARIANT: warehouseId = null → คลังหลัก (main) ของสาขา.
//   ทุก call site เดิมที่ "ไม่ส่ง warehouseId" ต้องได้ WHERE เดิมเป๊ะ (aggregate ทุกห้อง = ยอดสาขาเดิม)
//   → zero regression. เฉพาะการอ่านต่อห้อง (per-warehouse) เท่านั้นที่ filter ตามห้อง.
//   ห้องหลัก (main) → รวมแถว legacy NULL ด้วย (OR warehouse_id IS NULL). ห้องอื่น → เท่ากับ id ตรง ๆ (ไม่รวม NULL).
// =============================================================

/**
 * คืน Prisma where-fragment สำหรับ scope ตามห้อง (warehouse):
 *   - warehouseId undefined → {} (aggregate ทุกห้อง = พฤติกรรมเดิม · branch total ไม่เปลี่ยน)
 *   - warehouseId === main   → { OR:[{warehouseId:main},{warehouseId:null}] } (แถว legacy NULL = ของห้องหลัก)
 *   - warehouseId อื่น       → { warehouseId } (strict · ไม่รวม NULL)
 * ⚠️ เมื่อจะ scope ห้องหลักต้องส่ง mainWarehouseId มาด้วย ไม่งั้นจะ treat เป็นห้องอื่น (strict).
 */
function warehouseWhere(
  warehouseId?: string,
  mainWarehouseId?: string,
): Record<string, unknown> {
  if (warehouseId === undefined) return {};
  if (mainWarehouseId && warehouseId === mainWarehouseId) {
    return { OR: [{ warehouseId }, { warehouseId: null }] };
  }
  return { warehouseId };
}

export type CfWarehouseRow = {
  id: string;
  name: string;
  isMain: boolean;
  isActive: boolean;
  sortOrder: number;
};

/** รายชื่อคลัง (ห้องเก็บ) ของสาขา — รวมทั้ง active + inactive · คลังหลัก (main) มาก่อนเสมอ */
export async function getCfWarehousesForBranch(
  orgId: string,
  branchId: string,
): Promise<CfWarehouseRow[]> {
  const rows = await prisma.cfWarehouse.findMany({
    where: { orgId, branchId },
    orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isMain: true, isActive: true, sortOrder: true },
  });
  return rows;
}

/** id ของคลังหลัก (isMain) ของสาขา — null ถ้าสาขายังไม่มีคลังหลัก (แถว movement เก่ายังนับเป็น main ผ่าน NULL) */
export async function getBranchMainWarehouseId(
  orgId: string,
  branchId: string,
): Promise<string | null> {
  const main = await prisma.cfWarehouse.findFirst({
    where: { orgId, branchId, isMain: true },
    select: { id: true },
  });
  return main?.id ?? null;
}

/**
 * ยอด "ระบบมี" ต่อสินค้า เฉพาะห้อง (warehouse) ที่เลือก — สำหรับฟอร์มนับสต๊อกเมื่อเลือกห้อง.
 * ห้องหลัก (main) → รวมแถว legacy NULL ด้วย. ห้องอื่น → เฉพาะแถวห้องนั้น. คงเงื่อนไข machineId:null (คลังสาขา ไม่รวมในตู้).
 */
export async function getCfBranchOnHandMapByWarehouse(
  orgId: string,
  branchId: string,
  warehouseId: string,
  mainWarehouseId?: string,
): Promise<Record<string, number>> {
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: {
      orgId,
      branchId,
      machineId: null,
      ...warehouseWhere(warehouseId, mainWarehouseId),
    },
    _sum: { qty: true },
  });
  const out: Record<string, number> = {};
  for (const m of moves) out[m.productId] = m._sum.qty ?? 0;
  return out;
}

/** สต๊อกรายสินค้าในสาขา — แยก warehouse (ไม่ใช่ในตู้) กับ inMachines (machineId != null)
 *  warehouseId (optional) — ละไว้ = รวมทุกห้อง (ยอดสาขาเดิม · พฤติกรรมเดิม) · ระบุ = เฉพาะห้องนั้น
 *  (ห้องหลักต้องส่ง mainWarehouseId ด้วยเพื่อรวมแถว legacy NULL). inMachines ยังคิดทั้งสาขา (ไม่ผูกห้องใน v1). */
export async function getCfBranchStockProducts(
  orgId: string,
  branchId: string,
  warehouseId?: string,
  mainWarehouseId?: string,
): Promise<CfStockProductRow[]> {
  const products = await prisma.cfProduct.findMany({
    where: { orgId, isActive: true },
    select: { id: true, sku: true, barcode: true, name: true, category: true, imageUrl: true, unitCostCents: true },
    orderBy: { name: "asc" },
  });
  if (products.length === 0) return [];

  // ผลรวม qty ต่อ product — แยกเป็น "ในตู้" (machineId != null) กับ "คลังสาขา" (machineId null)
  // warehouseId ละไว้ → warehouseWhere คืน {} → WHERE เดิมเป๊ะ (รวมทุกห้อง = ยอดสาขาเดิม · zero regression)
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, branchId, machineId: null, ...warehouseWhere(warehouseId, mainWarehouseId) },
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
      imageUrl: p.imageUrl,
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
  warehouseId?: string,
  mainWarehouseId?: string,
): Promise<Record<string, number>> {
  // warehouseId ละไว้ → warehouseWhere คืน {} → WHERE เดิมเป๊ะ (รวมทุกห้อง · พฤติกรรมเดิม · zero regression)
  const moves = await prisma.cfStockMovement.groupBy({
    by: ["productId"],
    where: { orgId, branchId, machineId: null, ...warehouseWhere(warehouseId, mainWarehouseId) },
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

// =============================================================
// bigfeature (N6) — ใบกระจายขาเข้าที่ยัง "ไม่รับ" ของสาขา (สำหรับหน้ารับสินค้ามือถือ)
//   status IN_TRANSIT หรือ SCHEDULED · เรียง eta/สร้างล่าสุด · แนบรายการ + จำนวนที่ระบุ/รับแล้ว
// =============================================================
export type CfInboundDeliveryRow = {
  id: string;
  status: string;
  itemsCount: number;
  unitsCount: number;
  createdAt: Date;
  lines: Array<{ productId: string; productName: string; qty: number; receivedQty: number }>;
};

/** ใบกระจายขาเข้าของสาขา (ยังไม่รับ · IN_TRANSIT/SCHEDULED) — พร้อมรายการต่อบรรทัด */
export async function getInboundDeliveries(branchId: string): Promise<CfInboundDeliveryRow[]> {
  const rows = await prisma.cfDelivery.findMany({
    where: { branchId, status: { in: ["IN_TRANSIT", "SCHEDULED"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      itemsCount: true,
      unitsCount: true,
      createdAt: true,
      lines: {
        select: { id: true, productId: true, productName: true, qty: true, receivedQty: true },
        orderBy: { productName: "asc" },
      },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    itemsCount: d.itemsCount,
    unitsCount: d.unitsCount,
    createdAt: d.createdAt,
    lines: d.lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      qty: l.qty,
      receivedQty: l.receivedQty,
    })),
  }));
}

// =============================================================
// surface-existing — ประวัติการเคลื่อนไหวรายสินค้า (per-product ledger · ใหม่→เก่า)
//   ใช้โชว์ในหน้ารายละเอียดสินค้า/ตู้ · optional filter สาขา
// =============================================================
export type CfProductMovementRow = {
  id: string;
  type: string;
  qty: number;
  occurredAt: Date;
  refTable: string | null;
  refId: string | null;
  machineId: string | null;
  unitCostCents: number;
};

/** การเคลื่อนไหวของสินค้าตัวเดียว (ทุกสาขา หรือกรองสาขา) เรียงใหม่สุดก่อน */
export async function getCfProductMovements(
  productId: string,
  branchId?: string,
): Promise<CfProductMovementRow[]> {
  const rows = await prisma.cfStockMovement.findMany({
    where: { productId, ...(branchId ? { branchId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      qty: true,
      occurredAt: true,
      refTable: true,
      refId: true,
      machineId: true,
      unitCostCents: true,
    },
  });
  return rows;
}

// =============================================================
// surface-existing — โหลดเอาต์ปัจจุบันของตู้ (สินค้า + ราคา/ครั้ง + รูป)
//   CfMachineLoadout ที่ยัง active (effectiveTo IS NULL) join รูปสินค้า
// =============================================================
export type CfMachineLoadoutRow = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  pricePerPlayCoins: number;
  setAt: Date;
};

/** โหลดเอาต์ปัจจุบันของตู้ (product+ราคา+รูป) — effectiveTo IS NULL */
export async function getMachineLoadout(machineId: string): Promise<CfMachineLoadoutRow[]> {
  const rows = await prisma.cfMachineLoadout.findMany({
    where: { machineId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
    select: {
      productId: true,
      pricePerPlayCoins: true,
      effectiveFrom: true,
      product: { select: { name: true, imageUrl: true } },
    },
  });
  return rows.map((r) => ({
    productId: r.productId,
    productName: r.product.name,
    imageUrl: r.product.imageUrl,
    pricePerPlayCoins: r.pricePerPlayCoins,
    setAt: r.effectiveFrom,
  }));
}

// =============================================================
// surface-existing — รายชื่อตู้ในสโคปผู้ใช้ (id/code/ชื่อ/สาขา) สำหรับ:
//   1) เลือกตู้ → ดูโหลดเอาต์ (in-machine loadout view) ในหน้าคลัง
//   2) ย้ายตู้ข้ามสาขา (reassign UI) ในหน้าสาขา
// org-scoped + กรองตามสาขาที่ผู้ใช้เห็น (userBranchIds). คืน [] เมื่อ error (หน้าเรียกใน try/catch).
// =============================================================
export type CfMachineListRow = {
  id: string;
  code: string;
  nickname: string | null;
  branchId: string;
  branchName: string;
  kind: string; // CLAW | EXCHANGER
  isActive: boolean;
};

/** รายชื่อตู้ทั้งหมดในสโคปผู้ใช้ พร้อมชื่อสาขา — เรียงตามสาขาแล้ว code */
export async function getCfMachinesForBranchAdmin(): Promise<CfMachineListRow[]> {
  try {
    const session = await requireCfSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);

    const rows = await prisma.cfMachine.findMany({
      where: {
        orgId,
        ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
      },
      orderBy: [{ branchId: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        nickname: true,
        branchId: true,
        kind: true,
        isActive: true,
        branch: { select: { name: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      code: m.code,
      nickname: m.nickname,
      branchId: m.branchId,
      branchName: m.branch?.name ?? "สาขา",
      kind: m.kind,
      isActive: m.isActive,
    }));
  } catch {
    return [];
  }
}
