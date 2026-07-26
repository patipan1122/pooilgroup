// DC · "จัดการสต๊อกเป็นใบ PO" — po-fulfillment ledger.
//
// ยอดต่อสินค้าในใบ PO ใบหนึ่ง (documentary · ไม่ใช่ physical lot):
//   ordered   = Σ DcPurchaseLine.qty            (สั่งกี่ชิ้น)
//   received  = Σ DcGoodsReceiptLine.qtyReceived (รับเข้าจริงกี่ชิ้น · จาก GRN ของใบนี้)
//   movedOut  = Σ โอน (DcTransferLine ที่ transfer.poId=ใบนี้ · ไม่นับ CANCELLED)
//             + Σ เบิก (ISSUE movement ที่ผูก DcIssue.poId=ใบนี้)
//   remaining = max(0, min(received − movedOut, onHand))  ("เหลือในใบ" — cap ไม่ให้เกินของจริง)
//   onHand    = ยอดคงเหลือจริงในคลัง (DcStockBalance) — แสดงคู่กันเพื่อเห็นทั้ง "ในใบ" และ "ของจริง"
//
// ★ money/stock note: poId เป็น "หลักฐานเชื่อมโยง" ไม่ได้ล็อกล็อตทางกายภาพ. การตัดสต๊อกจริง
//   ยังตัดจากยอดรวมต่อคลัง (onHand guard เดิม). remaining ใช้กันไม่ให้ ledger ของใบติดลบ.
// ★ cap remaining ≤ onHand (2026-07-11 · CEO): ถ้าของถูกเบิก/โอนออกแบบ "ไม่ได้อ้างใบ PO"
//   (movement ไม่มี po_id) → movedOut นับไม่ถึง → doc-remaining ค้างสูงเกินจริง (เช่น เหลือในใบ 24
//   ทั้งที่คงเหลือจริง 0 = เลขผี). cap ที่ onHand ให้ทั้ง ledger/picker/count ไม่มีวันโชว์หรือปล่อย
//   เบิก "ของที่ไม่มีอยู่จริง". consumer (po-move-picker/products-browse) cap ซ้ำที่ onHand อยู่แล้ว.

import { prisma } from "@/lib/prisma";
import { DcMoveKind } from "@/lib/generated/prisma/enums";

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
  title: string | null; // ชื่อเรียกใบที่ผู้ใช้ตั้ง (โชว์แทนเลขให้จำง่าย) · null = ยังไม่ตั้ง
  status: string;
  supplierName: string | null;
  createdAt: Date;
  receiveWarehouseIds: string[];
  lines: PoFulfillmentLine[];
  totals: { ordered: number; received: number; movedOut: number; remaining: number };
};

/**
 * รายละเอียด fulfillment ของใบ PO ใบเดียว (per-product ledger + onHand).
 * scope ด้วย orgId เสมอ. onHand อ่านที่ warehouseId ถ้าระบุ ·
 *   warehouseIds (หลายคลัง) → รวม onHand ข้ามคลังที่มีสิทธิ์ (office "รวมทุกคลัง") · ไม่ระบุเลย = ทุกคลัง.
 * คืน null ถ้าไม่พบใบใน org.
 */
export async function getPoFulfillment(
  orgId: string,
  poId: string,
  opts?: { warehouseId?: string; warehouseIds?: string[] },
): Promise<PoFulfillment | null> {
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: {
      id: true,
      poCode: true,
      title: true,
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

  // โอน/เบิกออกที่ tag "ใบ PO นี้" → movedOut ต่อ product (Pinpoint #2 · multi-PO)
  //   นับจาก movement.po_id โดยตรง (per-line) — รองรับโอน/เบิกจากหลายใบพร้อมกัน (header poId เดียวใช้ไม่ได้).
  //   NET: ISSUE/TRANSFER_OUT qty<0 (ออก) + reversal RETURN_IN qty>0 (คืน จาก cancel/delete) → movedOut = -Σqty
  //   → ใบยกเลิก/ลบ: out −N + reversal +N = 0 อัตโนมัติ (movement ledger เป็น immutable + compensating).
  //   ★ po_id ตั้งเฉพาะ source-out + reversal เท่านั้น (ไม่แตะ TRANSFER_IN ปลายทาง) → sum สะอาด.
  const movedByProduct = new Map<string, number>();
  const movedGrouped = await prisma.dcStockMovement.groupBy({
    by: ["productId"],
    where: {
      orgId,
      poId,
      kind: { in: [DcMoveKind.ISSUE, DcMoveKind.TRANSFER_OUT, DcMoveKind.RETURN_IN] },
    },
    _sum: { qty: true },
  });
  for (const g of movedGrouped) {
    const net = -(g._sum.qty ?? 0); // ออก(ลบ)→บวก · คืน(บวก)→ลบ · clamp ≥0 กัน reversal เกิน
    movedByProduct.set(g.productId, Math.max(0, net));
  }

  // onHand ต่อ product (ที่คลังที่ระบุ · ไม่งั้นรวมทุกคลัง)
  const onHandByProduct = new Map<string, number>();
  if (productIds.length > 0) {
    const balances = await prisma.dcStockBalance.findMany({
      where: {
        orgId,
        productId: { in: productIds },
        ...(opts?.warehouseId
          ? { warehouseId: opts.warehouseId }
          : opts?.warehouseIds && opts.warehouseIds.length
            ? { warehouseId: { in: opts.warehouseIds } }
            : {}),
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
    const onHand = onHandByProduct.get(pid) ?? 0;
    // "เหลือในใบ" = received − movedOut แต่ "ไม่เกินของจริงในคลัง" (onHand) — กันเลขผี (ดูหัวไฟล์).
    const remaining = Math.max(0, Math.min(received - movedOut, onHand));
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
      onHand,
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
    title: po.title ?? null,
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
  title: string | null; // ชื่อเรียกใบที่ผู้ใช้ตั้ง (โชว์แทนเลขให้จำง่าย) · null = ยังไม่ตั้ง
  supplierName: string | null;
  status: string;
  lineCount: number;
  /** productId (unique) ของสินค้าในใบ — ใช้โชว์ความคืบหน้าการนับต่อใบตั้งแต่หน้าเลือก (count picker). */
  productIds: string[];
  receivedAt: Date | null;
  /** ยอดรับเข้ารวมทั้งใบ (Σ received ต่อ product) — เป็น "ฐาน 100%" ของแถบคงเหลือ. */
  totalReceived: number;
  /** ยอดคงเหลือในใบรวมทั้งใบ (Σ remaining · สูตรเดียวกับ getPoFulfillment) — ในลิสต์นี้ > 0 เสมอ (ใบที่หมดถูกซ่อน). */
  totalRemaining: number;
};

/**
 * รายการใบ PO ที่ "เคยรับเข้าคลังแล้ว" (มี GRN) → เอาไว้ให้ผู้ใช้เลือกตอนโอน/เบิก "เป็นใบ PO".
 * ระบุ warehouseId → เฉพาะใบที่รับเข้าคลังนั้น · warehouseIds → หลายคลัง (office รวมทุกคลังที่มีสิทธิ์).
 * scope orgId เสมอ · เรียงใบที่รับล่าสุดก่อน · จำกัด 100 ใบ.
 *
 * ★ 2026-07-26 (CEO): แนบยอด "รับเข้ารวม/คงเหลือรวม" ต่อใบ (คิด batch ทีเดียว ไม่ยิงต่อใบ = ไม่ช้าแม้ PO เยอะขึ้น)
 *   และ "ซ่อนใบที่ของหมด" (totalRemaining ≤ 0) ออกจากทุก picker — เพราะเลือกไปก็ไม่มีของให้หยิบ.
 *   สูตร remaining ต่อ product = max(0, min(received − movedOut, onHand)) เหมือน getPoFulfillment เป๊ะ
 *   → เลขในลิสต์กับตอนคลิกเข้าไปตรงกัน (ไม่มีเคส "ลิสต์บอกมี พอเปิดใบหมด").
 */
export async function listReceivablePosForMove(
  orgId: string,
  opts?: { warehouseId?: string; warehouseIds?: string[] },
): Promise<ReceivablePoForMove[]> {
  const whFilter = opts?.warehouseId
    ? { warehouseId: opts.warehouseId }
    : opts?.warehouseIds && opts.warehouseIds.length
      ? { warehouseId: { in: opts.warehouseIds } }
      : {};
  const grns = await prisma.dcGoodsReceipt.findMany({
    where: { orgId, ...whFilter },
    select: { id: true, poId: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  });

  // poId ล่าสุดที่รับเข้า (unique · เก็บวันรับล่าสุด) + map grn→po สำหรับรวมยอดรับเข้า
  const latestReceivedByPo = new Map<string, Date>();
  const grnToPo = new Map<string, string>();
  for (const g of grns) {
    if (!g.poId) continue;
    grnToPo.set(g.id, g.poId);
    if (!latestReceivedByPo.has(g.poId)) latestReceivedByPo.set(g.poId, g.receivedAt);
  }
  const poIds = [...latestReceivedByPo.keys()];
  if (poIds.length === 0) return [];
  const grnIds = [...grnToPo.keys()];

  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId, id: { in: poIds } },
    select: {
      id: true,
      poCode: true,
      title: true,
      status: true,
      supplier: { select: { name: true } },
      lines: { select: { productId: true } },
    },
  });

  // ── ledger ต่อใบ (batch · สูตรเดียวกับ getPoFulfillment แต่ยิงรวมทุกใบทีเดียว) ──
  //   received[po][product] = Σ DcGoodsReceiptLine.qtyReceived (จับ grn กลับใบด้วย grnToPo)
  const receivedByPoProduct = new Map<string, Map<string, number>>();
  if (grnIds.length > 0) {
    const grouped = await prisma.dcGoodsReceiptLine.groupBy({
      by: ["grnId", "productId"],
      where: { orgId, grnId: { in: grnIds } },
      _sum: { qtyReceived: true },
    });
    for (const g of grouped) {
      const poId = grnToPo.get(g.grnId);
      if (!poId) continue;
      const inner = receivedByPoProduct.get(poId) ?? new Map<string, number>();
      inner.set(g.productId, (inner.get(g.productId) ?? 0) + (g._sum.qtyReceived ?? 0));
      receivedByPoProduct.set(poId, inner);
    }
  }

  //   movedOut[po][product] = max(0, -Σ movement.qty) เฉพาะ ISSUE/TRANSFER_OUT/RETURN_IN (NET · ดู getPoFulfillment)
  const movedByPoProduct = new Map<string, Map<string, number>>();
  const movedGrouped = await prisma.dcStockMovement.groupBy({
    by: ["poId", "productId"],
    where: {
      orgId,
      poId: { in: poIds },
      kind: { in: [DcMoveKind.ISSUE, DcMoveKind.TRANSFER_OUT, DcMoveKind.RETURN_IN] },
    },
    _sum: { qty: true },
  });
  for (const g of movedGrouped) {
    if (!g.poId) continue;
    const inner = movedByPoProduct.get(g.poId) ?? new Map<string, number>();
    inner.set(g.productId, Math.max(0, -(g._sum.qty ?? 0)));
    movedByPoProduct.set(g.poId, inner);
  }

  //   onHand[product] = Σ DcStockBalance.qtyOnHand (ตาม warehouse scope เดียวกับ picker) — cap กันเลขผี
  const allProductIds = [...new Set(pos.flatMap((p) => p.lines.map((l) => l.productId)))];
  const onHandByProduct = new Map<string, number>();
  if (allProductIds.length > 0) {
    const balances = await prisma.dcStockBalance.findMany({
      where: { orgId, productId: { in: allProductIds }, ...whFilter },
      select: { productId: true, qtyOnHand: true },
    });
    for (const b of balances) {
      onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
    }
  }

  return pos
    .map((p) => {
      // unique products ต่อใบ (fulfillment detail ก็ group ต่อ product) → lineCount + productIds ตรงกัน
      const productIds = [...new Set(p.lines.map((l) => l.productId))];
      const rcv = receivedByPoProduct.get(p.id);
      const mvd = movedByPoProduct.get(p.id);
      let totalReceived = 0;
      let totalRemaining = 0;
      for (const pid of productIds) {
        const received = rcv?.get(pid) ?? 0;
        const movedOut = mvd?.get(pid) ?? 0;
        const onHand = onHandByProduct.get(pid) ?? 0;
        totalReceived += received;
        totalRemaining += Math.max(0, Math.min(received - movedOut, onHand));
      }
      return {
        poId: p.id,
        poCode: p.poCode,
        title: p.title ?? null,
        supplierName: p.supplier?.name ?? null,
        status: p.status,
        lineCount: productIds.length,
        productIds,
        receivedAt: latestReceivedByPo.get(p.id) ?? null,
        totalReceived,
        totalRemaining,
      };
    })
    // ★ ซ่อนใบที่ของหมด (เหลือ 0) ออกจากทุก picker — เลือกไปก็ไม่มีของ (CEO 2026-07-26)
    .filter((p) => p.totalRemaining > 0)
    .sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0))
    .slice(0, 100);
}
