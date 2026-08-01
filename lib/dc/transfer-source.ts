// DC · "โอน/เบิก จากใบโอนที่รับเข้าคลัง" — มิเรอร์ po-fulfillment.ts แต่ต้นทางเป็น "ใบโอน" แทน "ใบ PO".
//
// ใช้กับ picker "เลือกจากใบโอน" (คู่กับ "เลือกจากใบ PO"): ของที่มาถึงคลังนี้ "ทางการโอน" (ไม่ใช่ซื้อเข้า
// จากใบ PO) จะเลือกจาก picker นี้เพื่อโอน/เบิกต่อได้ — ตอบโจทย์ "สาขา/คลังปลายทางรับของมาแล้ว อยากโอนต่อ/คืน".
//
// ★ ต่างจาก PO ตรงที่ "ใบโอน" ไม่มี ledger remaining ต่อใบ (movement outbound ผูกแค่ po_id ไม่มี transfer_id ต้นทาง
//   + สต๊อกในคลัง commingle ไม่ lot-track) → เราไม่สร้าง remaining ledger ใหม่. picker แค่ "พรีฟิลจำนวนที่รับเข้า"
//   แล้ว cap ด้วย onHand จริง (min(received, onHand)) — และ dispatchTransfer เช็ค onHand ซ้ำเป็นตัวตัดสินสุดท้าย
//   เหมือนที่ po-move-picker ทำ (ดูหัว po-fulfillment.ts). ไม่มีวันโชว์/ปล่อยโอน "ของที่ไม่มีอยู่จริง".
// ★ นับเฉพาะใบโอน "รับเข้าคลังนี้แล้ว" = destType WAREHOUSE + toWarehouseId=คลังนี้ + status CONFIRMED/AUTO_UNVERIFIED.
//   (MODULE/สาขา ไม่ลงสต๊อก DcStockBalance → ไม่เกี่ยวกับ picker ฝั่ง DC · received = qtyReceived ?? qty.)

import { prisma } from "@/lib/prisma";
import { DcTransferStatus, DcTransferDestType } from "@/lib/generated/prisma/enums";

const RECEIVED_STATUSES = [DcTransferStatus.CONFIRMED, DcTransferStatus.AUTO_UNVERIFIED];

export type TransferSourceLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  imageR2Path: string | null;
  /** รับเข้าจริงกี่ชิ้น (qtyReceived ?? qty) — ฐานพรีฟิล. */
  received: number;
  /** คงเหลือจริงในคลังปลายทางตอนนี้. */
  onHand: number;
  /** พรีฟิลได้ = min(received, onHand) — กันเลขผี (ของถูกโอน/เบิกต่อไปแล้ว). */
  available: number;
};

export type TransferSourceDetail = {
  transferId: string;
  transferCode: string;
  fromWarehouseName: string | null; // "โอนมาจากคลัง ..." (โชว์ให้จำง่าย)
  confirmedAt: Date | null;
  lines: TransferSourceLine[];
  totals: { received: number; available: number };
};

/**
 * รายละเอียดใบโอนที่รับเข้าคลังนี้ → ต่อสินค้า: รับเข้า / คงเหลือจริง / พรีฟิลได้.
 * scope orgId + ต้อง toWarehouseId===warehouseId (กันดึงใบโอนของคลังอื่นเข้ามาโอนผิดคลัง).
 * คืน null ถ้าไม่พบใบใน org/คลังนี้ หรือยังไม่รับเข้า.
 */
export async function getReceivedTransferDetail(
  orgId: string,
  transferId: string,
  opts: { warehouseId: string },
): Promise<TransferSourceDetail | null> {
  const tr = await prisma.dcTransfer.findFirst({
    where: {
      id: transferId,
      orgId,
      destType: DcTransferDestType.WAREHOUSE,
      toWarehouseId: opts.warehouseId, // cross-warehouse guard
      status: { in: RECEIVED_STATUSES },
    },
    select: {
      id: true,
      transferCode: true,
      confirmedAt: true,
      fromWarehouseId: true,
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
  if (!tr) return null;

  // รวมต่อ product (เผื่อมีหลายบรรทัดชนิดเดียวกัน) · received = qtyReceived ?? qty
  const receivedByProduct = new Map<string, number>();
  const meta = new Map<
    string,
    { sku: string; name: string; unit: string; imageR2Path: string | null }
  >();
  for (const l of tr.lines) {
    const rcv = l.qtyReceived ?? l.qty;
    receivedByProduct.set(l.productId, (receivedByProduct.get(l.productId) ?? 0) + rcv);
    if (!meta.has(l.productId)) {
      meta.set(l.productId, {
        sku: l.product.sku,
        name: l.product.name,
        unit: l.product.unit ?? "ชิ้น",
        imageR2Path: l.product.imageR2Path ?? null,
      });
    }
  }
  const productIds = [...receivedByProduct.keys()];

  // onHand ต่อ product ที่คลังปลายทาง (คลังเดียว = คลังที่รับเข้า)
  const onHandByProduct = new Map<string, number>();
  if (productIds.length > 0) {
    const balances = await prisma.dcStockBalance.findMany({
      where: { orgId, productId: { in: productIds }, warehouseId: opts.warehouseId },
      select: { productId: true, qtyOnHand: true },
    });
    for (const b of balances) {
      onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
    }
  }

  const fromWarehouseName = await warehouseName(orgId, tr.fromWarehouseId);

  const lines: TransferSourceLine[] = productIds.map((pid) => {
    const m = meta.get(pid)!;
    const received = receivedByProduct.get(pid) ?? 0;
    const onHand = onHandByProduct.get(pid) ?? 0;
    return {
      productId: pid,
      sku: m.sku,
      name: m.name,
      unit: m.unit,
      imageR2Path: m.imageR2Path,
      received,
      onHand,
      available: Math.max(0, Math.min(received, onHand)),
    };
  });
  // เรียง: มีของพรีฟิลได้ก่อน แล้วตามชื่อ
  lines.sort((a, b) => b.available - a.available || a.name.localeCompare(b.name, "th"));

  const totals = lines.reduce(
    (acc, l) => ({ received: acc.received + l.received, available: acc.available + l.available }),
    { received: 0, available: 0 },
  );

  return {
    transferId: tr.id,
    transferCode: tr.transferCode,
    fromWarehouseName,
    confirmedAt: tr.confirmedAt,
    lines,
    totals,
  };
}

export type ReceivedTransferForMove = {
  transferId: string;
  transferCode: string;
  fromWarehouseName: string | null;
  confirmedAt: Date | null;
  lineCount: number;
  productIds: string[];
  /** ยอดรับเข้ารวมทั้งใบ (ฐาน 100% ของแถบ). */
  totalReceived: number;
  /** ยอดพรีฟิลได้รวม (Σ min(received, onHand)) — ในลิสต์นี้ > 0 เสมอ (ใบที่ของหมดถูกซ่อน). */
  totalAvailable: number;
};

/**
 * รายการใบโอนที่ "รับเข้าคลังนี้แล้ว" → ให้เลือกตอนโอน/เบิก "จากใบโอน".
 * scope orgId + destType WAREHOUSE + toWarehouseId=คลังนี้ + status CONFIRMED/AUTO_UNVERIFIED.
 * เรียงใบที่รับล่าสุดก่อน · จำกัด 100 ใบ · ซ่อนใบที่ของหมด (totalAvailable ≤ 0) เหมือน PO picker.
 */
export async function listReceivedTransfersForMove(
  orgId: string,
  opts: { warehouseId: string },
): Promise<ReceivedTransferForMove[]> {
  const transfers = await prisma.dcTransfer.findMany({
    where: {
      orgId,
      destType: DcTransferDestType.WAREHOUSE,
      toWarehouseId: opts.warehouseId,
      status: { in: RECEIVED_STATUSES },
    },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      confirmedAt: true,
      dispatchedAt: true,
      lines: { select: { productId: true, qty: true, qtyReceived: true } },
    },
    orderBy: [{ confirmedAt: "desc" }, { dispatchedAt: "desc" }],
    take: 100,
  });
  if (transfers.length === 0) return [];

  // onHand ต่อ product (ที่คลังนี้ · batch ทีเดียว) — cap กันเลขผี
  const allProductIds = [...new Set(transfers.flatMap((t) => t.lines.map((l) => l.productId)))];
  const onHandByProduct = new Map<string, number>();
  if (allProductIds.length > 0) {
    const balances = await prisma.dcStockBalance.findMany({
      where: { orgId, productId: { in: allProductIds }, warehouseId: opts.warehouseId },
      select: { productId: true, qtyOnHand: true },
    });
    for (const b of balances) {
      onHandByProduct.set(b.productId, (onHandByProduct.get(b.productId) ?? 0) + b.qtyOnHand);
    }
  }

  // ชื่อคลังต้นทาง (batch)
  const fromIds = [...new Set(transfers.map((t) => t.fromWarehouseId))];
  const nameById = await warehouseNames(orgId, fromIds);

  return transfers
    .map((t) => {
      const receivedByProduct = new Map<string, number>();
      for (const l of t.lines) {
        receivedByProduct.set(
          l.productId,
          (receivedByProduct.get(l.productId) ?? 0) + (l.qtyReceived ?? l.qty),
        );
      }
      const productIds = [...receivedByProduct.keys()];
      let totalReceived = 0;
      let totalAvailable = 0;
      for (const pid of productIds) {
        const received = receivedByProduct.get(pid) ?? 0;
        const onHand = onHandByProduct.get(pid) ?? 0;
        totalReceived += received;
        totalAvailable += Math.max(0, Math.min(received, onHand));
      }
      return {
        transferId: t.id,
        transferCode: t.transferCode,
        fromWarehouseName: nameById.get(t.fromWarehouseId) ?? null,
        confirmedAt: t.confirmedAt,
        lineCount: productIds.length,
        productIds,
        totalReceived,
        totalAvailable,
      };
    })
    .filter((t) => t.totalAvailable > 0)
    .sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0))
    .slice(0, 100);
}

// ── helpers ────────────────────────────────────────────────────────────
async function warehouseName(orgId: string, warehouseId: string): Promise<string | null> {
  const w = await prisma.dcWarehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { name: true },
  });
  return w?.name ?? null;
}

async function warehouseNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const ws = await prisma.dcWarehouse.findMany({
    where: { orgId, id: { in: ids } },
    select: { id: true, name: true },
  });
  for (const w of ws) out.set(w.id, w.name);
  return out;
}
