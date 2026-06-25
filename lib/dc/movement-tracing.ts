// DC Warehouse · ตามรอยการเดินของสินค้า (movement tracing) — server-only.
//
// ★ อ่านอย่างเดียว — ไม่เขียนสต๊อก ไม่แตะ engine recordMovement.
//   ใช้สร้าง 2 อย่างใน UI:
//   1. getProductTimeline — ประวัติการเดินของสินค้า 1 ตัว (รับเข้า → โอน → เบิก → ปรับ)
//      เรียงใหม่→เก่า ผูกลิงก์เอกสารต้นทาง (ใบรับ GRN / ใบโอน) ให้ "กดต่อ" ได้
//   2. getGrnRemaining — ใบรับสินค้า 1 ใบ: แต่ละบรรทัด "รับเข้า X · เหลือในโกดังตอนนี้ Y"
//      (เหลือ = คงเหลือรวมของสินค้าในคลังของใบนี้ — ระดับสินค้า ไม่ใช่ราย-ล็อต ตามที่ CEO เคาะ)
//
// ZERO-COST-COLUMN ยังคงอยู่: ที่นี่ไม่อ่าน/ไม่คิดต้นทุน — ดึงแต่ qty + สถานะการเดิน.

import "server-only";
import { prisma } from "@/lib/prisma";
import { MOVE_KIND_LABEL } from "@/lib/dc/nav";

export type WarehouseLite = { id: string; name: string };

export type TimelineDocKind = "grn" | "transfer" | "floor";

/** เอกสารต้นทางของการเคลื่อนไหว — กดเข้าไปดูต่อได้ (ถ้ามี href) */
export type TimelineDoc = {
  kind: TimelineDocKind;
  code: string | null;
  href: string | null;
};

export type TimelineRow = {
  id: string;
  kind: string; // raw enum (RECEIVE / ISSUE / TRANSFER_OUT / ...)
  kindLabel: string; // ป้ายไทย
  direction: "in" | "out" | "flat"; // เข้า / ออก / ย้ายที่ (qty เป็น signed)
  qtySigned: number; // ตามที่เก็บ (+เข้า / −ออก / 0 ย้าย)
  qtyAbs: number;
  balanceAfter: number | null; // คงเหลือหลังรายการนี้
  warehouseName: string;
  occurredAt: string; // ISO
  note: string | null;
  doc: TimelineDoc | null;
};

function directionOf(qty: number): "in" | "out" | "flat" {
  if (qty > 0) return "in";
  if (qty < 0) return "out";
  return "flat"; // MOVE = ย้ายตำแหน่งในคลังเดียวกัน
}

/**
 * ประวัติการเดินของสินค้า 1 ตัว (timeline) — เรียงใหม่→เก่า.
 * เฉพาะคลังที่ผู้ใช้เข้าถึงได้ (ส่ง allowedWarehouses มาจาก getAllowedWarehouses).
 * ผูกลิงก์เอกสารต้นทาง: refType "grn" → ใบรับ · "dc_transfer*" → ใบโอน · "floor_*" → งานหน้าคลัง.
 * Batch-resolve รหัสเอกสาร (ไม่มี N+1).
 */
export async function getProductTimeline(args: {
  orgId: string;
  productId: string;
  allowedWarehouses: WarehouseLite[];
  limit?: number;
}): Promise<TimelineRow[]> {
  const { orgId, productId } = args;
  const limit = args.limit ?? 200;
  const allowedIds = args.allowedWarehouses.map((w) => w.id);
  if (allowedIds.length === 0) return [];
  const nameById = new Map(args.allowedWarehouses.map((w) => [w.id, w.name]));

  const rows = await prisma.dcStockMovement.findMany({
    where: { orgId, productId, warehouseId: { in: allowedIds } },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      qty: true,
      balanceAfter: true,
      warehouseId: true,
      occurredAt: true,
      note: true,
      refType: true,
      refId: true,
    },
  });

  const grnIds = [
    ...new Set(rows.filter((r) => r.refType === "grn" && r.refId).map((r) => r.refId as string)),
  ];
  const transferIds = [
    ...new Set(
      rows.filter((r) => r.refType?.startsWith("dc_transfer") && r.refId).map((r) => r.refId as string),
    ),
  ];

  const [grns, transfers] = await Promise.all([
    grnIds.length
      ? prisma.dcGoodsReceipt.findMany({ where: { orgId, id: { in: grnIds } }, select: { id: true, grnCode: true } })
      : Promise.resolve([] as { id: string; grnCode: string }[]),
    transferIds.length
      ? prisma.dcTransfer.findMany({
          where: { orgId, id: { in: transferIds } },
          select: { id: true, transferCode: true },
        })
      : Promise.resolve([] as { id: string; transferCode: string }[]),
  ]);
  const grnCodeById = new Map(grns.map((g) => [g.id, g.grnCode]));
  const transferCodeById = new Map(transfers.map((t) => [t.id, t.transferCode]));

  return rows.map((m): TimelineRow => {
    let doc: TimelineDoc | null = null;
    if (m.refType === "grn" && m.refId) {
      doc = { kind: "grn", code: grnCodeById.get(m.refId) ?? null, href: `/dc/office/receipts/${m.refId}` };
    } else if (m.refType?.startsWith("dc_transfer") && m.refId) {
      doc = {
        kind: "transfer",
        code: transferCodeById.get(m.refId) ?? null,
        href: `/dc/office/transfers/${m.refId}`,
      };
    } else if (m.refType?.startsWith("floor_")) {
      doc = { kind: "floor", code: null, href: null };
    }
    return {
      id: m.id,
      kind: m.kind,
      kindLabel: MOVE_KIND_LABEL[m.kind] ?? m.kind,
      direction: directionOf(m.qty),
      qtySigned: m.qty,
      qtyAbs: Math.abs(m.qty),
      balanceAfter: m.balanceAfter,
      warehouseName: nameById.get(m.warehouseId) ?? "—",
      occurredAt: m.occurredAt.toISOString(),
      note: m.note,
      doc,
    };
  });
}

export type GrnRemainingLine = {
  lineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  imageR2Path: string | null;
  qtyReceived: number;
  qtyDamaged: number;
  /** คงเหลือสินค้านี้ในคลังของใบนี้ "ตอนนี้" (ระดับสินค้า รวมทุกใบ — ตามที่ CEO เคาะ) */
  onHandNow: number;
};

export type GrnRemaining = {
  id: string;
  grnCode: string;
  warehouseId: string;
  warehouseName: string;
  receivedAt: string;
  status: string;
  postStatus: string;
  note: string | null;
  shipmentCode: string | null;
  poCode: string | null;
  lines: GrnRemainingLine[];
  totalReceived: number;
  totalOnHandNow: number;
};

/**
 * ใบรับสินค้า 1 ใบ + "เหลือในโกดังตอนนี้" ของแต่ละบรรทัด.
 * เหลือ = คงเหลือรวมของสินค้าในคลังของใบนี้ (DcStockBalance ระดับสินค้า/คลัง) —
 * ไม่ใช่ราย-ล็อต เพราะ DC ไม่ทำ FIFO ราย-ใบ (CEO เคาะ 2026-06-25).
 * คืน null ถ้าไม่พบใบในองค์กรนี้.
 */
export async function getGrnRemaining(args: { orgId: string; grnId: string }): Promise<GrnRemaining | null> {
  const { orgId, grnId } = args;

  const grn = await prisma.dcGoodsReceipt.findFirst({
    where: { orgId, id: grnId },
    select: {
      id: true,
      grnCode: true,
      warehouseId: true,
      poId: true,
      receivedAt: true,
      status: true,
      postStatus: true,
      note: true,
      shipment: { select: { shipmentCode: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          qtyReceived: true,
          qtyDamaged: true,
          product: { select: { sku: true, name: true, unit: true, imageR2Path: true } },
        },
      },
    },
  });
  if (!grn) return null;

  const productIds = grn.lines.map((l) => l.productId);
  const [balances, wh, po] = await Promise.all([
    productIds.length
      ? prisma.dcStockBalance.findMany({
          where: { orgId, warehouseId: grn.warehouseId, productId: { in: productIds } },
          select: { productId: true, qtyOnHand: true },
        })
      : Promise.resolve([] as { productId: string; qtyOnHand: number }[]),
    prisma.dcWarehouse.findFirst({ where: { orgId, id: grn.warehouseId }, select: { name: true } }),
    grn.poId
      ? prisma.dcPurchaseOrder.findFirst({ where: { orgId, id: grn.poId }, select: { poCode: true } })
      : Promise.resolve(null),
  ]);
  const onHandById = new Map(balances.map((b) => [b.productId, b.qtyOnHand]));

  const lines: GrnRemainingLine[] = grn.lines.map((l) => ({
    lineId: l.id,
    productId: l.productId,
    sku: l.product.sku,
    name: l.product.name,
    unit: l.product.unit,
    imageR2Path: l.product.imageR2Path,
    qtyReceived: l.qtyReceived,
    qtyDamaged: l.qtyDamaged,
    onHandNow: onHandById.get(l.productId) ?? 0,
  }));

  return {
    id: grn.id,
    grnCode: grn.grnCode,
    warehouseId: grn.warehouseId,
    warehouseName: wh?.name ?? "—",
    receivedAt: grn.receivedAt.toISOString(),
    status: grn.status,
    postStatus: grn.postStatus,
    note: grn.note,
    shipmentCode: grn.shipment?.shipmentCode ?? null,
    poCode: po?.poCode ?? null,
    lines,
    totalReceived: lines.reduce((s, l) => s + l.qtyReceived, 0),
    totalOnHandNow: lines.reduce((s, l) => s + l.onHandNow, 0),
  };
}
