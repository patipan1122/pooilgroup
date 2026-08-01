// DC · "ดูสินค้าเป็นรายการตามใบโอน" — transfer-fulfillment (read-only).
//
// คู่ขนานกับ po-fulfillment.ts แต่ฝั่ง "ใบโอน" (ของที่รับเข้าคลังจากการโอนภายใน ไม่ใช่ซื้อ).
//   ยอดต่อสินค้าในใบโอนใบหนึ่ง:
//     sent     = Σ DcTransferLine.qty                 (โอนมากี่ชิ้น)
//     received = Σ (DcTransferLine.qtyReceived ?? qty) (รับเข้าจริง · AUTO_UNVERIFIED ไม่มี qtyReceived → ถือว่ารับครบ)
//     onHand   = คงเหลือจริงที่ "คลังปลายทาง" (DcStockBalance @ toWarehouseId)
//
// ★ ต่างจาก PO: ใบโอนไม่มีแนวคิด "เหลือในใบ/movedOut" (downstream move ไม่ได้ tag transferId)
//   → โชว์แค่ โอนมา→รับ + คงเหลือจริง (ไม่มี ledger remaining) = ตรงไปตรงมา ไม่มีเลขผี.
// ★ นับเฉพาะใบโอนปลายทาง "คลัง" (destType=WAREHOUSE) ที่รับแล้ว (CONFIRMED/AUTO_UNVERIFIED)
//   — โอนไป ClawFleet branch (MODULE) รับในแอป ClawFleet คนละที่. scope orgId เสมอ.

import { prisma } from "@/lib/prisma";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";

const RECEIVED_STATUSES = [DcTransferStatus.CONFIRMED, DcTransferStatus.AUTO_UNVERIFIED];

export type TransferFulfillmentLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  imageR2Path: string | null;
  sent: number;
  received: number;
  onHand: number;
};

export type TransferFulfillment = {
  transferId: string;
  transferCode: string;
  status: string;
  fromName: string | null;
  toName: string | null;
  receivedAt: Date | null; // confirmedAt ?? dispatchedAt
  lines: TransferFulfillmentLine[];
  totals: { sent: number; received: number };
};

export type ReceivedTransferForBrowse = {
  transferId: string;
  transferCode: string;
  fromName: string | null;
  toName: string | null;
  status: string;
  lineCount: number;
  receivedAt: Date | null;
  /** Σ received ต่อสินค้าในใบ — จำนวนของที่รับเข้าจากใบโอนนี้ */
  totalReceived: number;
};

/**
 * รายการใบโอนที่ "รับเข้าคลังแล้ว" — ให้ผู้ใช้เลือกดูสินค้าตามใบ.
 * ระบุ warehouseId → เฉพาะใบที่ปลายทางเป็นคลังนั้น · warehouseIds → หลายคลัง (office รวมทุกคลังที่มีสิทธิ์).
 * scope orgId เสมอ · เรียงใบที่รับล่าสุดก่อน · จำกัด 100 ใบ.
 */
export async function listReceivedTransfersForBrowse(
  orgId: string,
  opts?: { warehouseId?: string; warehouseIds?: string[] },
): Promise<ReceivedTransferForBrowse[]> {
  const toFilter = opts?.warehouseId
    ? { toWarehouseId: opts.warehouseId }
    : opts?.warehouseIds && opts.warehouseIds.length
      ? { toWarehouseId: { in: opts.warehouseIds } }
      : {};

  const transfers = await prisma.dcTransfer.findMany({
    where: {
      orgId,
      destType: DcTransferDestType.WAREHOUSE,
      status: { in: RECEIVED_STATUSES },
      ...toFilter,
    },
    orderBy: { dispatchedAt: "desc" },
    take: 100,
    select: {
      id: true,
      transferCode: true,
      status: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      confirmedAt: true,
      dispatchedAt: true,
      lines: { select: { productId: true, qty: true, qtyReceived: true } },
    },
  });
  if (transfers.length === 0) return [];

  // join ชื่อคลัง (ต้นทาง + ปลายทาง)
  const whIds = new Set<string>();
  for (const t of transfers) {
    whIds.add(t.fromWarehouseId);
    if (t.toWarehouseId) whIds.add(t.toWarehouseId);
  }
  const whs = whIds.size
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: [...whIds] }, orgId }, select: { id: true, name: true } })
    : [];
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  return transfers
    .map((t) => {
      const products = new Set<string>();
      let totalReceived = 0;
      for (const l of t.lines) {
        products.add(l.productId);
        totalReceived += l.qtyReceived ?? l.qty;
      }
      return {
        transferId: t.id,
        transferCode: t.transferCode,
        fromName: t.fromWarehouseId ? (whName.get(t.fromWarehouseId) ?? null) : null,
        toName: t.toWarehouseId ? (whName.get(t.toWarehouseId) ?? null) : null,
        status: t.status,
        lineCount: products.size,
        receivedAt: t.confirmedAt ?? t.dispatchedAt,
        totalReceived,
      };
    })
    .sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0));
}

/**
 * รายละเอียดใบโอนใบเดียว: ต่อสินค้า โอนมา/รับ/คงเหลือจริง (onHand ที่คลังปลายทาง).
 * scope orgId เสมอ · คืน null ถ้าไม่พบใบใน org.
 */
export async function getTransferFulfillment(
  orgId: string,
  transferId: string,
): Promise<TransferFulfillment | null> {
  const t = await prisma.dcTransfer.findFirst({
    where: { id: transferId, orgId },
    select: {
      id: true,
      transferCode: true,
      status: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      confirmedAt: true,
      dispatchedAt: true,
      lines: {
        select: {
          productId: true,
          qty: true,
          qtyReceived: true,
          product: { select: { sku: true, name: true, unit: true, imageR2Path: true } },
        },
      },
    },
  });
  if (!t) return null;

  // รวมยอดต่อ product (เผื่อมีหลายบรรทัดชนิดเดียวกันในใบ)
  const sentByProduct = new Map<string, number>();
  const recvByProduct = new Map<string, number>();
  const meta = new Map<string, { sku: string; name: string; unit: string; imageR2Path: string | null }>();
  for (const l of t.lines) {
    sentByProduct.set(l.productId, (sentByProduct.get(l.productId) ?? 0) + l.qty);
    recvByProduct.set(l.productId, (recvByProduct.get(l.productId) ?? 0) + (l.qtyReceived ?? l.qty));
    if (!meta.has(l.productId)) {
      meta.set(l.productId, {
        sku: l.product.sku,
        name: l.product.name,
        unit: l.product.unit ?? "ชิ้น",
        imageR2Path: l.product.imageR2Path ?? null,
      });
    }
  }
  const productIds = [...meta.keys()];

  // onHand ที่คลังปลายทาง (ที่ของถูกโอนไปลง)
  const onHandByProduct = new Map<string, number>();
  if (productIds.length > 0 && t.toWarehouseId) {
    const balances = await prisma.dcStockBalance.findMany({
      where: { orgId, productId: { in: productIds }, warehouseId: t.toWarehouseId },
      select: { productId: true, qtyOnHand: true },
    });
    for (const b of balances) {
      onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
    }
  }

  // ชื่อคลัง
  const whIds = [t.fromWarehouseId, t.toWarehouseId].filter((x): x is string => !!x);
  const whs = whIds.length
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } })
    : [];
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  const lines: TransferFulfillmentLine[] = productIds.map((pid) => {
    const m = meta.get(pid)!;
    return {
      productId: pid,
      sku: m.sku,
      name: m.name,
      unit: m.unit,
      imageR2Path: m.imageR2Path,
      sent: sentByProduct.get(pid) ?? 0,
      received: recvByProduct.get(pid) ?? 0,
      onHand: onHandByProduct.get(pid) ?? 0,
    };
  });
  // เรียง: มีของในคลังก่อน แล้วตามชื่อ
  lines.sort((a, b) => (b.onHand - a.onHand) || a.name.localeCompare(b.name, "th"));

  const totals = lines.reduce(
    (acc, l) => ({ sent: acc.sent + l.sent, received: acc.received + l.received }),
    { sent: 0, received: 0 },
  );

  return {
    transferId: t.id,
    transferCode: t.transferCode,
    status: t.status,
    fromName: t.fromWarehouseId ? (whName.get(t.fromWarehouseId) ?? null) : null,
    toName: t.toWarehouseId ? (whName.get(t.toWarehouseId) ?? null) : null,
    receivedAt: t.confirmedAt ?? t.dispatchedAt,
    lines,
    totals,
  };
}
