// ClawFleet · ส่งคืนคลังกลาง (DC) — query helpers สำหรับหน้าจอ picker (read-only · org+branch scoped)
//   getBranchReturnableFromTransfer — เลือกจากใบโอน: map ใบโอน DC ที่รับเข้าสาขาแล้ว → CfProduct + prefill qty
//   listReceivedTransfersForBranch — รายการใบโอนที่ "รับเข้าสาขาแล้ว" (layer list ของ picker · mirror getInboundDcTransfers)
//
// ★ READ-ONLY: ไม่แตะสต๊อก/ไม่สร้าง CfProduct (การเขียนอยู่ที่ branch-return-actions.ts เท่านั้น).
//   map DcProduct→CfProduct ใช้ DcProductLink (forward) + fallback barcode — ไม่เรียก resolveClawfleetProduct
//   (ตัวนั้นจะ "สร้าง" CfProduct ถ้าไม่เจอ ซึ่ง picker ไม่ควรทำ). ถ้าจับคู่ไม่ได้ = ไม่มีของในสาขา → ข้าม.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { CLAWFLEET_MODULE } from "@/lib/dc/product-link";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";

// client ของ transaction (prisma assignable โดย structural typing) — ใช้เรียก aggregate ตรง ๆ ได้
type CfDb = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** "ของบนชั้นจริง" (NET) ทั้งสาขา = Σ ทุกแถว — mirror currentNetShelf ใน stock-actions.ts (source of truth) */
async function currentNetShelf(db: CfDb, orgId: string, branchId: string, productId: string): Promise<number> {
  const agg = await db.cfStockMovement.aggregate({
    where: { orgId, branchId, productId },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? 0;
}

/** cfProductId จาก DcProduct (forward link → fallback barcode · read-only ไม่สร้าง) · null = ยังไม่เคยรับเข้า CF */
async function cfProductIdFromDc(
  orgId: string,
  dcProduct: { id: string; barcode: string | null },
): Promise<string | null> {
  const link = await prisma.dcProductLink.findFirst({
    where: { orgId, productId: dcProduct.id, destModule: CLAWFLEET_MODULE },
    orderBy: { id: "asc" },
    select: { destProductId: true },
  });
  if (link) return link.destProductId;
  if (dcProduct.barcode) {
    const cf = await prisma.cfProduct.findFirst({
      where: { orgId, barcode: dcProduct.barcode },
      select: { id: true },
    });
    if (cf) return cf.id;
  }
  return null;
}

// =============================================================
// getBranchReturnableFromTransfer — "เลือกจากใบโอน" picker (prefill รายการส่งคืนจากใบโอนที่รับแล้ว)
// =============================================================
export type ReturnableLine = {
  cfProductId: string;
  dcProductId: string;
  productName: string;
  receivedQty: number; // จำนวนที่รับเข้าสาขา (qtyReceived ถ้ามี · ไม่งั้น qty ที่โอน)
  branchOnHand: number; // ของบนชั้นตอนนี้ (NET)
  prefillQty: number; // ค่าที่เติมให้ = min(received, onHand) · ไม่ให้คืนเกินของที่มี
  unitCostCents: number; // ต้นทุนล่าสุดของ CfProduct (1:1 satang↔cents)
};

/**
 * ให้ใบโอน DC ที่ "รับเข้าสาขานี้แล้ว" (CONFIRMED/AUTO_UNVERIFIED · destType MODULE · toBranchId=สาขานี้)
 * → คืนรายการ CfProduct ของใบนั้น พร้อม received qty + ของบนชั้นปัจจุบัน → prefill = min(received, onHand).
 */
export async function getBranchReturnableFromTransfer(
  branchId: string,
  transferId: string,
): Promise<ReturnableLine[]> {
  if (!branchId || !transferId) return [];
  const session = await requireSession();
  const orgId = session.user.org_id;

  // สาขาต้องเป็นตู้คีบของ org จริง (mirror guard ใน getInboundDcTransfers)
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine", isActive: true },
    select: { id: true },
  });
  if (!branch) return [];

  const t = await prisma.dcTransfer.findFirst({
    where: {
      id: transferId,
      orgId,
      toBranchId: branchId,
      destType: DcTransferDestType.MODULE,
      status: { in: [DcTransferStatus.CONFIRMED, DcTransferStatus.AUTO_UNVERIFIED] },
    },
    select: {
      lines: {
        select: {
          qty: true,
          qtyReceived: true,
          product: { select: { id: true, barcode: true, name: true } },
        },
      },
    },
  });
  if (!t) return [];

  const out: ReturnableLine[] = [];
  for (const l of t.lines) {
    const cfProductId = await cfProductIdFromDc(orgId, l.product);
    if (!cfProductId) continue; // ยังไม่มี CfProduct = ไม่มีของในสาขา → ข้าม
    const cf = await prisma.cfProduct.findFirst({
      where: { id: cfProductId, orgId },
      select: { unitCostCents: true },
    });
    const received = l.qtyReceived ?? l.qty;
    const onHand = await currentNetShelf(prisma, orgId, branchId, cfProductId);
    out.push({
      cfProductId,
      dcProductId: l.product.id,
      productName: l.product.name,
      receivedQty: received,
      branchOnHand: onHand,
      prefillQty: Math.max(0, Math.min(received, onHand)),
      unitCostCents: cf?.unitCostCents ?? 0,
    });
  }
  // เรียงตามชื่อสินค้า (อ่านง่าย · mirror lines orderBy productName)
  out.sort((a, b) => a.productName.localeCompare(b.productName, "th"));
  return out;
}

// =============================================================
// listReceivedTransfersForBranch — รายการใบโอนที่ "รับเข้าสาขาแล้ว" (list layer ของ picker)
//   mirror getInboundDcTransfers แต่ status = CONFIRMED/AUTO_UNVERIFIED (ไม่ใช่ IN_TRANSIT)
// =============================================================
export type ReceivedTransferRow = {
  transferId: string;
  transferCode: string;
  status: string;
  dispatchedAt: Date;
  confirmedAt: Date | null;
  fromName: string | null; // คลังต้นทาง DC
  itemsCount: number;
  unitsCount: number;
};

export async function listReceivedTransfersForBranch(branchId: string): Promise<ReceivedTransferRow[]> {
  if (!branchId) return [];
  const session = await requireSession();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine", isActive: true },
    select: { id: true },
  });
  if (!branch) return [];

  const rows = await prisma.dcTransfer.findMany({
    where: {
      orgId,
      toBranchId: branchId,
      destType: DcTransferDestType.MODULE,
      status: { in: [DcTransferStatus.CONFIRMED, DcTransferStatus.AUTO_UNVERIFIED] },
    },
    orderBy: { dispatchedAt: "desc" },
    take: 50,
    select: {
      id: true,
      transferCode: true,
      status: true,
      dispatchedAt: true,
      confirmedAt: true,
      fromWarehouseId: true,
      lines: { select: { qty: true } },
    },
  });

  // ชื่อคลังต้นทาง (batch · N ใบ = 1 query)
  const whIds = [...new Set(rows.map((t) => t.fromWarehouseId))];
  const whs = whIds.length
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } })
    : [];
  const whMap = new Map(whs.map((w) => [w.id, w.name]));

  return rows.map((t) => ({
    transferId: t.id,
    transferCode: t.transferCode,
    status: t.status,
    dispatchedAt: t.dispatchedAt,
    confirmedAt: t.confirmedAt,
    fromName: whMap.get(t.fromWarehouseId) ?? null,
    itemsCount: t.lines.length,
    unitsCount: t.lines.reduce((s, l) => s + l.qty, 0),
  }));
}
