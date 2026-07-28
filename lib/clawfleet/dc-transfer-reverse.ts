// ถอนใบโอน DC ออกจากคลังสาขา (สำหรับ super_admin ลบใบโอนที่ "รับแล้ว" · CEO 2026-07-28).
//
// ⚠️ ตั้งใจ "ไม่มี" 'use server' — เป็นตรรกะ server ภายใน (เรียกโดย lib/dc/delete-actions เท่านั้น)
//    ไม่ใช่ server-action endpoint → กันถูกเรียกตรงจาก client ด้วย orgId ข้ามองค์กร (adversarial P1).
//
// mirror ตรงข้าม receiveDcTransferIntoBranchTx — ถอนเฉพาะ "ของบนชั้นจริง" (NET · เหมือน currentNetShelf):
//   Σ ทุกแถวในห้อง (ไม่กรอง machineId → หักของที่เติมเข้าตู้/เบิกไปแล้ว) + warehouseId null-coalesced.
//   clamp ไม่ให้ติดลบ · ส่วนที่เติมเข้าตู้/เบิก/ขายไปแล้ว = ถอนไม่ได้ (แจ้งเตือน ไม่บล็อก).
//   ไม่ลบแถว movement เดิม (balance history เพี้ยน) → append รายการกลับ (compensating) + ลบใบรับ (GRN).

import { prisma } from "@/lib/prisma";

type CfTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type DcBranchImpactItem = {
  productId: string;
  name: string;
  received: number; // รับเข้าคลังสาขาจากใบนี้ (TRANSFER_IN)
  onShelf: number; // ของบนชั้นจริงตอนนี้ (NET · หักเติมตู้/เบิกแล้ว)
  reversible: number; // ถอนคืนได้ = min(received, onShelf)
  consumed: number; // ใช้ไปแล้ว (เติมตู้/เบิก/ขาย) ถอนไม่ได้ = received − reversible
};

/**
 * "ของบนชั้นจริง" (NET) ของสินค้าในห้องหนึ่ง — mirror currentNetShelf ใน stock-actions.ts:
 *   Σ ทุกแถว (ไม่กรอง machineId → หัก LOAD_TO_MACHINE ที่เติมเข้าตู้) + warehouseId null-coalesced
 *   (รวม WITHDRAW ที่ stamp warehouseId=null · และห้องหลักที่ stamp id จริงหรือ null = ห้องเดียวกัน).
 * ⚠️ ห้ามใช้ machineId:null (จะไม่หักของที่โหลดเข้าตู้ → ถอนเกิน → สต๊อกติดลบ · adversarial P0).
 */
async function netShelfQty(
  tx: CfTxClient,
  orgId: string,
  branchId: string,
  productId: string,
  warehouseId: string | null,
  mainWarehouseId: string | null,
): Promise<number> {
  const isMainRoom = warehouseId == null || warehouseId === mainWarehouseId;
  const whFilter = isMainRoom
    ? { OR: [{ warehouseId: mainWarehouseId }, { warehouseId: null }] }
    : { warehouseId };
  const agg = await tx.cfStockMovement.aggregate({
    where: { orgId, branchId, productId, ...whFilter },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? 0;
}

function loadReceivedMoves(tx: CfTxClient, orgId: string, transferId: string) {
  return tx.cfStockMovement.findMany({
    where: { orgId, refTable: "dc_transfers", refId: transferId, type: "TRANSFER_IN" },
    select: { productId: true, qty: true, branchId: true, warehouseId: true, unitCostCents: true },
  });
}

async function branchMainWarehouseId(tx: CfTxClient, orgId: string, branchId: string): Promise<string | null> {
  const w = await tx.cfWarehouse.findFirst({ where: { orgId, branchId, isMain: true }, select: { id: true } });
  return w?.id ?? null;
}

/** READ-ONLY · ผลกระทบถ้าลบใบโอนที่รับเข้าคลังสาขาแล้ว (ต่อสินค้า · ไม่เขียนอะไร). */
export async function getDcTransferBranchImpact(
  orgId: string,
  transferId: string,
): Promise<DcBranchImpactItem[]> {
  return prisma.$transaction(async (tx) => {
    const moves = await loadReceivedMoves(tx, orgId, transferId);
    if (moves.length === 0) return [];
    const mainWh = await branchMainWarehouseId(tx, orgId, moves[0].branchId);
    const pIds = [...new Set(moves.map((m) => m.productId))];
    const products = await tx.cfProduct.findMany({ where: { id: { in: pIds }, orgId }, select: { id: true, name: true } });
    const nameMap = new Map(products.map((p) => [p.id, p.name]));
    const items: DcBranchImpactItem[] = [];
    for (const m of moves) {
      const onShelf = Math.max(0, await netShelfQty(tx, orgId, m.branchId, m.productId, m.warehouseId, mainWh));
      const received = m.qty;
      const reversible = Math.min(received, onShelf);
      items.push({
        productId: m.productId,
        name: nameMap.get(m.productId) ?? "— สินค้า —",
        received,
        onShelf,
        reversible,
        consumed: received - reversible,
      });
    }
    return items;
  });
}

/** ถอนสต๊อกใบโอน DC ออกจากคลังสาขา (ใน tx ของ caller · clamp ไม่ติดลบ) + ลบใบรับ (GRN). */
export async function reverseDcTransferFromBranchTx(
  tx: CfTxClient,
  orgId: string,
  transferId: string,
  transferCode: string,
  actorUserId: string,
): Promise<{ reversedRows: number; items: DcBranchImpactItem[] }> {
  const moves = await loadReceivedMoves(tx, orgId, transferId);
  const items: DcBranchImpactItem[] = [];
  let reversedRows = 0;
  if (moves.length === 0) return { reversedRows, items };
  const mainWh = await branchMainWarehouseId(tx, orgId, moves[0].branchId);
  const pIds = [...new Set(moves.map((m) => m.productId))];
  const products = await tx.cfProduct.findMany({ where: { id: { in: pIds }, orgId }, select: { id: true, name: true } });
  const nameMap = new Map(products.map((p) => [p.id, p.name]));
  const now = new Date();
  // sort ตาม productId → ลำดับล็อกคงที่ (mirror receive · กัน AB-BA deadlock)
  const sorted = [...moves].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  for (const m of sorted) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${m.productId}))`;
    const onShelf = Math.max(0, await netShelfQty(tx, orgId, m.branchId, m.productId, m.warehouseId, mainWh));
    const received = m.qty;
    const reversible = Math.min(received, onShelf);
    const consumed = received - reversible;
    if (reversible > 0) {
      await tx.cfStockMovement.create({
        data: {
          orgId,
          branchId: m.branchId,
          warehouseId: m.warehouseId,
          machineId: null,
          type: "TRANSFER_OUT", // ถอนออกจากคลังสาขา (qty ลบ) — คู่ตรงข้ามกับ TRANSFER_IN ตอนรับ
          productId: m.productId,
          qty: -reversible,
          unitCostCents: m.unitCostCents,
          occurredAt: now,
          createdById: actorUserId,
          refTable: "dc_transfer_delete",
          refId: transferId,
          documentType: "transfer",
          documentId: transferId,
          reason: `ลบใบโอน ${transferCode} — ถอนสต๊อกคลังสาขาคืน ${reversible}${consumed > 0 ? ` (ใช้ไปแล้ว ${consumed} ถอนไม่ได้)` : ""}`,
        },
      });
      reversedRows += 1;
    }
    items.push({ productId: m.productId, name: nameMap.get(m.productId) ?? "— สินค้า —", received, onShelf, reversible, consumed });
  }
  // ลบใบรับ (GRN) ที่เกิดจากใบโอนนี้ — lines cascade (CfGoodsReceiptLine onDelete Cascade)
  await tx.cfGoodsReceipt.deleteMany({ where: { orgId, refTable: "dc_transfers", refId: transferId } });
  return { reversedRows, items };
}
