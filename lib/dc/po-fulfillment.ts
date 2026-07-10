// DC · "จัดการสต๊อกเป็นใบ PO" — po-fulfillment ledger.
//
// ยอดต่อสินค้าในใบ PO ใบหนึ่ง (documentary · ไม่ใช่ physical lot):
//   ordered   = Σ DcPurchaseLine.qty            (สั่งกี่ชิ้น)
//   received  = Σ DcGoodsReceiptLine.qtyReceived (รับเข้าจริงกี่ชิ้น · จาก GRN ของใบนี้)
//   movedOut  = Σ โอน (DcTransferLine ที่ transfer.poId=ใบนี้ · ไม่นับ CANCELLED)
//             + Σ เบิก (ISSUE movement ที่ผูก DcIssue.poId=ใบนี้)
//   remaining = max(0, received − movedOut)      ("เหลือในใบ PO นี้" ที่ยังไม่ถูกโอน/เบิกออก)
//   onHand    = ยอดคงเหลือจริงในคลัง (DcStockBalance) — แสดงคู่กันเพื่อเห็นทั้ง "ในใบ" และ "ของจริง"
//
// ★ money/stock note: poId เป็น "หลักฐานเชื่อมโยง" ไม่ได้ล็อกล็อตทางกายภาพ. การตัดสต๊อกจริง
//   ยังตัดจากยอดรวมต่อคลัง (onHand guard เดิม). remaining ใช้กันไม่ให้ ledger ของใบติดลบ.

import { prisma } from "@/lib/prisma";
import { DcMoveKind, DcTransferStatus } from "@/lib/generated/prisma/enums";

export type PoFulfillmentLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  imageR2Path: string | null;
  ordered: number;
  received: number;
  movedOut: number;
  remaining: number;
  onHand: number;
};

export type PoFulfillment = {
  poId: string;
  poCode: string;
  status: string;
  supplierName: string | null;
  createdAt: Date;
  receiveWarehouseIds: string[];
  lines: PoFulfillmentLine[];
  totals: { ordered: number; received: number; movedOut: number; remaining: number };
};

/**
 * รายละเอียด fulfillment ของใบ PO ใบเดียว (per-product ledger + onHand).
 * scope ด้วย orgId เสมอ. onHand อ่านที่ warehouseId ถ้าระบุ (ไม่งั้นรวมทุกคลัง).
 * คืน null ถ้าไม่พบใบใน org.
 */
export async function getPoFulfillment(
  orgId: string,
  poId: string,
  opts?: { warehouseId?: string },
): Promise<PoFulfillment | null> {
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: {
      id: true,
      poCode: true,
      status: true,
      createdAt: true,
      supplier: { select: { name: true } },
      lines: {
        select: {
          productId: true,
          qty: true,
          product: { select: { sku: true, name: true, unit: true, imageR2Path: true } },
        },
      },
    },
  });
  if (!po) return null;

  // สินค้าที่อยู่ในใบ (รวม qty สั่งต่อ product เผื่อมีหลายบรรทัดชนิดเดียวกัน)
  const orderedByProduct = new Map<string, number>();
  const meta = new Map<
    string,
    { sku: string; name: string; unit: string; imageR2Path: string | null }
  >();
  for (const l of po.lines) {
    orderedByProduct.set(l.productId, (orderedByProduct.get(l.productId) ?? 0) + l.qty);
    if (!meta.has(l.productId)) {
      meta.set(l.productId, {
        sku: l.product.sku,
        name: l.product.name,
        unit: l.product.unit ?? "ชิ้น",
        imageR2Path: l.product.imageR2Path ?? null,
      });
    }
  }
  const productIds = [...orderedByProduct.keys()];

  // GRN ของใบนี้ → received ต่อ product + คลังที่รับเข้า
  const grns = await prisma.dcGoodsReceipt.findMany({
    where: { orgId, poId },
    select: { id: true, warehouseId: true },
  });
  const grnIds = grns.map((g) => g.id);
  const receiveWarehouseIds = [...new Set(grns.map((g) => g.warehouseId))];

  const receivedByProduct = new Map<string, number>();
  if (grnIds.length > 0) {
    const grouped = await prisma.dcGoodsReceiptLine.groupBy({
      by: ["productId"],
      where: { orgId, grnId: { in: grnIds } },
      _sum: { qtyReceived: true },
    });
    for (const g of grouped) receivedByProduct.set(g.productId, g._sum.qtyReceived ?? 0);
  }

  // โอนออกที่ tag ใบนี้ (ไม่นับใบยกเลิก) → movedOut ต่อ product
  const movedByProduct = new Map<string, number>();
  const transfers = await prisma.dcTransfer.findMany({
    where: { orgId, poId, status: { not: DcTransferStatus.CANCELLED } },
    select: { id: true },
  });
  const transferIds = transfers.map((t) => t.id);
  if (transferIds.length > 0) {
    // นับจาก movement TRANSFER_OUT "ที่เกิดจริง" (ไม่ใช่แถวบรรทัด) — ใบที่ dispatch ล้มกลางคัน
    // (สร้างบรรทัดแล้วแต่ movement บางบรรทัดไม่เกิด) จะไม่ inflate movedOut → self-correcting เหมือนฝั่งเบิก.
    // TRANSFER_OUT qty เป็นค่าติดลบ → นับเป็นจำนวนที่ออก = |Σ| · ใบยกเลิกถูกกรองออกแล้ว (transferIds ไม่รวม CANCELLED).
    const grouped = await prisma.dcStockMovement.groupBy({
      by: ["productId"],
      where: {
        orgId,
        kind: DcMoveKind.TRANSFER_OUT,
        refType: "dc_transfer",
        refId: { in: transferIds },
      },
      _sum: { qty: true },
    });
    for (const g of grouped) movedByProduct.set(g.productId, Math.abs(g._sum.qty ?? 0));
  }

  // เบิกออกที่ tag ใบนี้ → movement ISSUE ที่ refId ∈ issues(poId=ใบนี้)
  const issues = await prisma.dcIssue.findMany({
    where: { orgId, poId },
    select: { id: true },
  });
  const issueIds = issues.map((i) => i.id);
  if (issueIds.length > 0) {
    const grouped = await prisma.dcStockMovement.groupBy({
      by: ["productId"],
      where: { orgId, kind: DcMoveKind.ISSUE, refType: "dc_issue", refId: { in: issueIds } },
      _sum: { qty: true },
    });
    // qty ของ ISSUE เป็นค่าติดลบ → นับเป็นจำนวนที่เบิกออก = |Σ|
    for (const g of grouped) {
      const abs = Math.abs(g._sum.qty ?? 0);
      movedByProduct.set(g.productId, (movedByProduct.get(g.productId) ?? 0) + abs);
    }
  }

  // onHand ต่อ product (ที่คลังที่ระบุ · ไม่งั้นรวมทุกคลัง)
  const onHandByProduct = new Map<string, number>();
  if (productIds.length > 0) {
    const balances = await prisma.dcStockBalance.findMany({
      where: {
        orgId,
        productId: { in: productIds },
        ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      },
      select: { productId: true, qtyOnHand: true },
    });
    for (const b of balances) {
      onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
    }
  }

  const lines: PoFulfillmentLine[] = productIds.map((pid) => {
    const m = meta.get(pid)!;
    const ordered = orderedByProduct.get(pid) ?? 0;
    const received = receivedByProduct.get(pid) ?? 0;
    const movedOut = movedByProduct.get(pid) ?? 0;
    const remaining = Math.max(0, received - movedOut);
    return {
      productId: pid,
      sku: m.sku,
      name: m.name,
      unit: m.unit,
      imageR2Path: m.imageR2Path,
      ordered,
      received,
      movedOut,
      remaining,
      onHand: onHandByProduct.get(pid) ?? 0,
    };
  });
  // เรียง: มีของเหลือให้โอน/เบิกก่อน แล้วตามชื่อ
  lines.sort((a, b) => (b.remaining - a.remaining) || a.name.localeCompare(b.name, "th"));

  const totals = lines.reduce(
    (acc, l) => ({
      ordered: acc.ordered + l.ordered,
      received: acc.received + l.received,
      movedOut: acc.movedOut + l.movedOut,
      remaining: acc.remaining + l.remaining,
    }),
    { ordered: 0, received: 0, movedOut: 0, remaining: 0 },
  );

  return {
    poId: po.id,
    poCode: po.poCode,
    status: po.status,
    supplierName: po.supplier?.name ?? null,
    createdAt: po.createdAt,
    receiveWarehouseIds,
    lines,
    totals,
  };
}

export type ReceivablePoForMove = {
  poId: string;
  poCode: string;
  supplierName: string | null;
  status: string;
  lineCount: number;
  receivedAt: Date | null;
};

/**
 * รายการใบ PO ที่ "เคยรับเข้าคลังแล้ว" (มี GRN) → เอาไว้ให้ผู้ใช้เลือกตอนโอน/เบิก "เป็นใบ PO".
 * ถ้าระบุ warehouseId → เฉพาะใบที่รับเข้าคลังนั้น (ให้ตรงกับคลังต้นทางที่จะโอน/เบิก).
 * scope orgId เสมอ · เรียงใบที่รับล่าสุดก่อน · จำกัด 100 ใบ.
 */
export async function listReceivablePosForMove(
  orgId: string,
  warehouseId?: string,
): Promise<ReceivablePoForMove[]> {
  const grns = await prisma.dcGoodsReceipt.findMany({
    where: { orgId, ...(warehouseId ? { warehouseId } : {}) },
    select: { poId: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  });

  // poId ล่าสุดที่รับเข้า (unique · เก็บวันรับล่าสุด)
  const latestReceivedByPo = new Map<string, Date>();
  for (const g of grns) {
    if (!g.poId) continue;
    if (!latestReceivedByPo.has(g.poId)) latestReceivedByPo.set(g.poId, g.receivedAt);
  }
  const poIds = [...latestReceivedByPo.keys()];
  if (poIds.length === 0) return [];

  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId, id: { in: poIds } },
    select: {
      id: true,
      poCode: true,
      status: true,
      supplier: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });

  return pos
    .map((p) => ({
      poId: p.id,
      poCode: p.poCode,
      supplierName: p.supplier?.name ?? null,
      status: p.status,
      lineCount: p._count.lines,
      receivedAt: latestReceivedByPo.get(p.id) ?? null,
    }))
    .sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0))
    .slice(0, 100);
}
