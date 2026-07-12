// ClawFleet · Stock WMS read-side — โหลดข้อมูลให้แท็บคลังสินค้า (server-only)
// สต๊อกปัจจุบัน = ผลรวม signed qty ใน cf_stock_movements (ledger-derived · ไม่มีคอลัมน์ stock)

import { prisma } from "@/lib/prisma";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
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

/**
 * สาขาตู้คีบ (ClawFleet) ที่ผู้ใช้ปัจจุบัน "ส่งของไปได้" — สำหรับ dropdown ปลายทางในหน้าโอนของ DC.
 *   scope ตามสิทธิ์เหมือน stock-queries อื่น ๆ (userBranchIds): แอดมิน/viewer = 'ALL' · อื่น = เฉพาะสาขาที่สังกัด.
 *   คืนเฉพาะ businessType='claw_machine' + isActive. { id, name }.
 */
export async function listClawfleetBranchTargets(
  orgId: string,
): Promise<Array<{ id: string; name: string }>> {
  const session = await requireCfSession();
  if (session.user.org_id !== orgId) return [];
  const allowed = await userBranchIds(session);
  const rows = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(allowed === "ALL" ? {} : { id: { in: allowed } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
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
//
//   ★ 2 แหล่งของ "ของรอรับ" ที่หน้ามือถือรวมกัน — ต่างกันที่ "เครื่องรับ" (write path) คนละตัว:
//     • source="cf_delivery" → ใบ cfDelivery (ในโมดูล ClawFleet เอง) → รับด้วย confirmShipmentReceived
//     • source="dc_transfer"  → ใบโอนจากคลังกลาง DC (destType=MODULE + สาขาตู้คีบ) → รับด้วย confirmTransfer
//       (เข้าเครื่องเงินตัวเดียว receiveDcTransferIntoBranchTx · idempotency refTable='dc_transfers').
//   ★ discriminator `source` บังคับให้ปุ่ม "กดรับ" route ถูก write path — กันรับซ้ำข้ามชนิด (guard คนละ refTable).
// =============================================================
export type CfInboundSource = "cf_delivery" | "dc_transfer";
export type CfInboundDeliveryRow = {
  id: string;
  status: string;
  itemsCount: number;
  unitsCount: number;
  createdAt: Date;
  // แหล่ง/write-path ของใบนี้ (ปุ่มกดรับ route ตามค่านี้) · dc_transfer → มี transferId
  source: CfInboundSource;
  transferId?: string;
  lines: Array<{
    // lineId มากับใบเลย (cfDelivery = DeliveryLine.id · dc_transfer = DcTransferLine.id) — ไม่ต้อง lookup แยก
    lineId: string;
    productId: string;
    productName: string;
    qty: number;
    receivedQty: number;
    // รูปสินค้า (CfProduct.imageUrl · URL เต็ม) — โชว์ thumbnail บนการ์ดรับสินค้า · null = ไม่มีรูป
    imageUrl: string | null;
  }>;
};

// รูปสินค้าจาก R2 key (หรือ URL เต็ม) → URL เต็ม · null = ไม่มีรูป (pattern เดียวกับ lib/dc/doc-data.ts)
//   ใช้กับ DcProduct.imageR2Path (ใบโอน DC ที่ยังไม่รับ · ยังไม่มี CfProduct). CfProduct.imageUrl เป็น URL เต็มอยู่แล้ว.
function toCfImageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  const base = process.env.R2_PUBLIC_URL ?? "";
  return base ? `${base}/${key}` : null;
}

/** ใบกระจายขาเข้าของสาขา (ยังไม่รับ · IN_TRANSIT/SCHEDULED) — พร้อมรายการต่อบรรทัด (source=cf_delivery) */
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

  // F1 · รูปสินค้าต่อบรรทัด — DeliveryLine เก็บ productId (snapshot ชื่อ) แต่ไม่ join product ตรง ๆ
  //   → รวม productId ทุกใบแล้ว join CfProduct ครั้งเดียว (efficient · N ใบ = 1 query รูป). ไม่มี = null.
  const cfProductIds = Array.from(new Set(rows.flatMap((d) => d.lines.map((l) => l.productId))));
  const cfImgMap = new Map<string, string | null>();
  if (cfProductIds.length > 0) {
    const products = await prisma.cfProduct.findMany({
      where: { id: { in: cfProductIds } },
      select: { id: true, imageUrl: true },
    });
    for (const p of products) cfImgMap.set(p.id, p.imageUrl);
  }

  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    itemsCount: d.itemsCount,
    unitsCount: d.unitsCount,
    createdAt: d.createdAt,
    source: "cf_delivery" as const,
    lines: d.lines.map((l) => ({
      lineId: l.id,
      productId: l.productId,
      productName: l.productName,
      qty: l.qty,
      receivedQty: l.receivedQty,
      imageUrl: cfImgMap.get(l.productId) ?? null,
    })),
  }));
}

/**
 * ใบโอนจากคลังกลาง DC ที่ "ปลายทาง = สาขาตู้คีบนี้" และยัง "ไม่รับ" (สำหรับหน้ารับสินค้ามือถือ).
 *   เงื่อนไข: destType=MODULE + toBranchId=branchId + status=IN_TRANSIT (dispatched แล้ว ยังไม่ปิด/รับ).
 *   สาขาต้องเป็นตู้คีบจริง (businessType='claw_machine' · active) — กันใบโอนไปโมดูลอื่นหลุดมาโผล่.
 *   คืนรูปเดียวกับ CfInboundDeliveryRow แต่ source='dc_transfer' + transferId (ปุ่มกดรับ → confirmTransfer).
 *   lineId = DcTransferLine.id (ใช้ตอนรับ "ไม่ครบ" ราย line ผ่าน confirmTransfer({lines})).
 *   qty = ที่ส่งออก · receivedQty = qtyReceived (null → 0 · ยังไม่รับ). itemsCount/unitsCount คิดจาก line.
 */
export async function getInboundDcTransfers(branchId: string): Promise<CfInboundDeliveryRow[]> {
  if (!branchId) return [];
  // สาขานี้เป็นตู้คีบจริงไหม (กันใบ MODULE ที่ toBranchId ชี้สาขาประเภทอื่น)
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessType: "claw_machine", isActive: true },
    select: { id: true },
  });
  if (!branch) return [];

  const rows = await prisma.dcTransfer.findMany({
    where: {
      toBranchId: branchId,
      destType: DcTransferDestType.MODULE,
      status: DcTransferStatus.IN_TRANSIT,
    },
    orderBy: { dispatchedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      dispatchedAt: true,
      lines: {
        select: {
          id: true,
          qty: true,
          qtyReceived: true,
          // F1 · imageR2Path ของสินค้า DC (ปลายทาง) — ยังไม่มี CfProduct จนกว่าจะกดรับ (map ตอน confirm)
          //   → ใช้รูปของ DcProduct ที่โชว์อยู่แล้ว (แปลง R2 key → URL เต็ม). null = ไม่มีรูป.
          product: { select: { id: true, name: true, imageR2Path: true } },
        },
      },
    },
  });

  return rows.map((t) => {
    const lines = t.lines.map((l) => ({
      lineId: l.id,
      productId: l.product.id,
      productName: l.product.name,
      qty: l.qty,
      receivedQty: l.qtyReceived ?? 0,
      imageUrl: toCfImageUrl(l.product.imageR2Path),
    }));
    // เรียงตามชื่อสินค้า (mirror cfDelivery lines orderBy productName)
    lines.sort((a, b) => a.productName.localeCompare(b.productName, "th"));
    return {
      id: t.id,
      status: t.status,
      itemsCount: lines.length,
      unitsCount: lines.reduce((s, l) => s + l.qty, 0),
      createdAt: t.dispatchedAt,
      source: "dc_transfer" as const,
      transferId: t.id,
      lines,
    };
  });
}

// =============================================================
// F2 — "ประวัติรับสินค้าเข้าคลัง" (received history) ที่หน้ามือถือ
//   อ่านจาก LEDGER จริง (cf_stock_movements type RECEIPT_IN/TRANSFER_IN) = source of truth —
//   ไม่ sum จาก child rows ของเอกสารแม่ (memory feedback-documentary-ledger-sum-events-not-child-rows:
//   ถ้าเอกสารแม่ commit ไม่ atomic ครึ่งใบจะเพี้ยน · ledger movement เขียนใน tx เดียวกับการรับ = ตรงเสมอ).
//   collapse ทุก movement ที่ (refTable, refId) เดียวกัน = "1 ใบที่รับแล้ว" · resolve เอกสารต้นทางเพื่อเอา code.
//   READ-ONLY — ไม่เขียน movement/สต๊อก/ต้นทุนใด ๆ.
// =============================================================
export type CfReceivedDocLine = {
  productName: string;
  qty: number; // จำนวนที่รับจริง (จาก movement.qty · +)
  imageUrl: string | null; // CfProduct.imageUrl (URL เต็ม) · null = ไม่มีรูป
};
export type CfReceivedDoc = {
  id: string; // = refId (id เอกสารต้นทาง: cfDelivery.id หรือ dcTransfer.id)
  source: "cf_delivery" | "dc_transfer";
  code: string; // deliveryCode/transferCode (ถ้า resolve เอกสารต้นทางไม่ได้ → fallback สั้น)
  receivedAt: Date; // เวลารับ (movement.occurredAt ล่าสุดในกลุ่ม)
  receivedById: string | null; // ผู้รับ (movement.createdById)
  receivedByName: string | null; // ชื่อผู้รับ (resolve จาก User)
  photoUrls: string[]; // รูปหลักฐานตอนรับ (cf เท่านั้น — แนบบน RECEIPT_IN movement · dc ไม่มี)
  unitsCount: number; // รวมชิ้นที่รับ (Σ qty)
  lines: CfReceivedDocLine[];
};

/**
 * ประวัติ "รับสินค้าเข้าคลัง" ล่าสุดของสาขา (READ-ONLY · จาก ledger).
 *   อ่าน CfStockMovement type IN (RECEIPT_IN, TRANSFER_IN) ของสาขา เรียง occurredAt ใหม่→เก่า
 *   → collapse เป็น "ใบที่รับแล้ว" ต่อ (refTable, refId) · limit = จำนวนใบ (ไม่ใช่จำนวน movement).
 *   source: refTable 'cf_deliveries' → cf_delivery (code = CfDelivery.??) · 'dc_transfers' → dc_transfer (transferCode).
 *   ผู้รับ/เวลา: จาก movement (createdById/occurredAt) — CfDelivery ไม่มีคอลัมน์ receivedAt/receivedById.
 *   scope: orgId + branchId เสมอ (ไม่รั่วข้ามสาขา).
 */
export async function getReceivedHistory(
  orgId: string,
  branchId: string,
  limit = 50,
): Promise<CfReceivedDoc[]> {
  if (!orgId || !branchId) return [];

  // ดึง movement RECEIPT_IN/TRANSFER_IN ของสาขา (ใหม่→เก่า). ดึงเผื่อหลาย movement/ใบ → cap ที่ limit*40 บรรทัด
  //   (พอสำหรับ ~limit ใบที่มีสินค้าไม่เกิน 40 ชนิด/ใบ) กัน payload บาน · แล้ว collapse เป็นใบ.
  const moves = await prisma.cfStockMovement.findMany({
    where: { orgId, branchId, type: { in: ["RECEIPT_IN", "TRANSFER_IN"] } },
    orderBy: { occurredAt: "desc" },
    take: Math.max(limit, 1) * 40,
    select: {
      productId: true,
      qty: true,
      occurredAt: true,
      createdById: true,
      refTable: true,
      refId: true,
      photoUrls: true,
    },
  });
  if (moves.length === 0) return [];

  // collapse ตาม (refTable, refId) — 1 กลุ่ม = 1 ใบที่รับแล้ว. movement ที่ไม่มี ref (refId null) ข้าม
  //   (ประวัติต้องผูกกับเอกสารต้นทางเพื่อออก "ใบรับ" ได้). รักษาลำดับใหม่→เก่าตาม movement แรกที่เจอ.
  type Group = {
    refTable: string;
    refId: string;
    occurredAt: Date; // ล่าสุดในกลุ่ม
    createdById: string;
    photoUrls: string[];
    // รวม qty ต่อ product (product ซ้ำหลาย movement/ใบ → รวมเป็นบรรทัดเดียว)
    qtyByProduct: Map<string, number>;
  };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const m of moves) {
    if (!m.refId || !m.refTable) continue;
    const key = `${m.refTable}::${m.refId}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        refTable: m.refTable,
        refId: m.refId,
        occurredAt: m.occurredAt,
        createdById: m.createdById,
        photoUrls: [],
        qtyByProduct: new Map(),
      };
      byKey.set(key, g);
      groups.push(g);
    }
    // occurredAt ล่าสุดของกลุ่ม (moves เรียง desc อยู่แล้ว → ตัวแรกที่เจอคือล่าสุด · คงไว้)
    if (m.photoUrls.length > 0) g.photoUrls.push(...m.photoUrls);
    g.qtyByProduct.set(m.productId, (g.qtyByProduct.get(m.productId) ?? 0) + m.qty);
  }

  // เอาเฉพาะ limit ใบแรก (ใหม่สุด) → แล้วค่อย resolve เอกสาร/ชื่อ/รูป (ประหยัด query)
  const top = groups.slice(0, limit);
  if (top.length === 0) return [];

  const cfIds = top.filter((g) => g.refTable === "cf_deliveries").map((g) => g.refId);
  const dcIds = top.filter((g) => g.refTable === "dc_transfers").map((g) => g.refId);
  const productIds = Array.from(new Set(top.flatMap((g) => [...g.qtyByProduct.keys()])));
  const userIds = Array.from(new Set(top.map((g) => g.createdById)));

  const [cfDeliveries, dcTransfers, products, users] = await Promise.all([
    cfIds.length
      ? prisma.cfDelivery.findMany({
          where: { id: { in: cfIds }, orgId, branchId, status: "DELIVERED" },
          select: { id: true, createdAt: true },
        })
      : Promise.resolve([]),
    dcIds.length
      ? prisma.dcTransfer.findMany({
          where: { id: { in: dcIds }, orgId, toBranchId: branchId, status: DcTransferStatus.CONFIRMED },
          select: { id: true, transferCode: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.cfProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, imageUrl: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const cfSet = new Set(cfDeliveries.map((d) => d.id));
  const dcMap = new Map(dcTransfers.map((t) => [t.id, t.transferCode]));
  const pMap = new Map(products.map((p) => [p.id, p]));
  const uMap = new Map(users.map((u) => [u.id, u.name]));

  const out: CfReceivedDoc[] = [];
  for (const g of top) {
    const isCf = g.refTable === "cf_deliveries";
    // resolve เอกสารต้นทาง (สถานะ + scope ถูกต้อง) — ไม่พบ = ข้าม (กันโชว์ใบที่ไม่ตรงสาขา/ถูกลบ/ยังไม่ปิด)
    if (isCf && !cfSet.has(g.refId)) continue;
    if (!isCf && !dcMap.has(g.refId)) continue;

    const lines: CfReceivedDocLine[] = [];
    let unitsCount = 0;
    for (const [pid, qty] of g.qtyByProduct) {
      const p = pMap.get(pid);
      unitsCount += qty;
      lines.push({
        productName: p?.name ?? "— สินค้า —",
        qty,
        imageUrl: p?.imageUrl ?? null,
      });
    }
    lines.sort((a, b) => a.productName.localeCompare(b.productName, "th"));

    out.push({
      id: g.refId,
      source: isCf ? "cf_delivery" : "dc_transfer",
      // cf_deliveries ไม่มี "code" คอลัมน์ → ใช้ id ท่อนสั้น · dc_transfers ใช้ transferCode จริง
      code: isCf ? `รับ-${g.refId.slice(0, 8)}` : dcMap.get(g.refId) ?? `รับ-${g.refId.slice(0, 8)}`,
      receivedAt: g.occurredAt,
      receivedById: g.createdById,
      receivedByName: uMap.get(g.createdById) ?? null,
      photoUrls: g.photoUrls,
      unitsCount,
      lines,
    });
  }
  return out;
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
