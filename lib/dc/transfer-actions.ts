"use server";

// DC Warehouse · TRANSFER (ส่ง/โอน) — 2-step in-transit + 1-tap confirm.
//
// WORKSHOP-LOCKED behavior (do NOT change without re-running the workshop):
//   • โอนเป็น 2 จังหวะ — ไม่ "รับเข้า" คลังปลายทางเงียบ ๆ อัตโนมัติ:
//       1) DISPATCH ที่ต้นทาง  → ต้นทาง qtyOnHand −n, qtyInTransit +n · สถานะ IN_TRANSIT
//       2) CONFIRM ที่ปลายทาง (กดเดียว) → ปลายทาง qtyOnHand +n, ต้นทาง qtyInTransit −n · สถานะ CONFIRMED
//     ต้นทุน "ตามของไป" — carry unitCostSatang/costLayerId ของต้นทางมาที่ใบรับปลายทาง
//     (การโอนไม่ใช่การตีราคาใหม่ revaluation).
//   • sameSite=true (ย้ายในไซต์เดียวกัน ปลายทางเป็น DC warehouse ที่เราคุมเอง) → รับเข้าทันที (auto-confirm)
//   • ปลายทาง = MODULE/สาขา (Playland/ตู้คีบ/สาขา · destType=MODULE) → บันทึก dispatch (TRANSFER_OUT) อย่างเดียว
//     แล้วกด "ยืนยันส่งถึง" (1 tap) ปิดใบเป็น CONFIRMED. การ "เขียนเข้า" ledger ของโมดูลอื่นเป็น PHASE 3
//     — ที่นี่ห้ามแตะตารางโมดูลอื่น เพียงปิดใบ DC + ลด in-transit ของต้นทาง.
//   • autoPromoteStaleTransfers — ใบ IN_TRANSIT ที่ค้างเกิน N ชม. → WAREHOUSE: รับเข้าอัตโนมัติ + mark
//     AUTO_UNVERIFIED (ติดธง ไม่หายเงียบ ๆ) · MODULE: mark AUTO_UNVERIFIED + ปิด in-transit. (reconcile job เรียก)
//
// ★ IDEMPOTENCY: client uuid ต่อใบ + ต่อบรรทัด → sourceKey("tfo",transferId,lineKey) ตอนส่งออก /
//   sourceKey("tfi",transferId,lineId) ตอนรับเข้า → @@unique([orgId,sourceKey]) ทำให้กดซ้ำ/รีทราย = no-op.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { sourceKey, transferCode } from "@/lib/dc/codes";
import { prisma } from "@/lib/prisma";
import { DcMoveKind, DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { recordMovement, findProductByCode, getOnHand } from "@/lib/dc/stock";

// ════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════

/**
 * อ่าน "ต้นทุนล่าสุด" ของสินค้าในคลังต้นทาง — เอามาแปะตามของไปปลายทาง.
 * ดูจาก movement ที่นำของ "เข้า" ล่าสุด (RECEIVE/TRANSFER_IN) ที่มี unitCostSatang.
 * คืน null ทั้งคู่ถ้าไม่เคยมีต้นทุน (เช่นของที่ไม่เคยผ่านการรับเข้าแบบมีต้นทุน).
 */
async function latestCostAtSource(
  orgId: string,
  warehouseId: string,
  productId: string,
): Promise<{ unitCostSatang: number | null; costLayerId: string | null }> {
  const mv = await prisma.dcStockMovement.findFirst({
    where: {
      orgId,
      warehouseId,
      productId,
      kind: { in: [DcMoveKind.RECEIVE, DcMoveKind.TRANSFER_IN] },
      unitCostSatang: { not: null },
    },
    orderBy: { occurredAt: "desc" },
    select: { unitCostSatang: true, costLayerId: true },
  });
  return { unitCostSatang: mv?.unitCostSatang ?? null, costLayerId: mv?.costLayerId ?? null };
}

// ════════════════════════════════════════════════════════════════════
// lookup (สแกน/พิมพ์รหัสหน้าส่งออก)
// ════════════════════════════════════════════════════════════════════

export type LookupForTransferResult =
  | {
      ok: true;
      product: {
        id: string;
        name: string;
        sku: string;
        unit: string;
        onHand: number;
      };
    }
  | { ok: false; error: string };

/** ค้นหาสินค้าจากบาร์โค้ด/SKU + อ่านยอดคงเหลือที่คลังต้นทาง. scope ด้วย orgId. */
export async function lookupForTransfer(args: {
  fromWarehouseId: string;
  code: string;
}): Promise<LookupForTransferResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const code = (args.code ?? "").trim();
  if (!code) return { ok: false, error: "กรุณากรอกรหัส" };

  const from = (args.fromWarehouseId ?? "").trim();
  if (!from) return { ok: false, error: "ยังไม่ได้เลือกคลังต้นทาง" };

  try {
    await assertWarehouseAllowed(session, from);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const product = await findProductByCode(orgId, code);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  const onHand = await getOnHand(from, product.id);

  return {
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit ?? "ชิ้น",
      onHand,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// dispatch (ส่งออกจากต้นทาง → สร้างใบโอน)
// ════════════════════════════════════════════════════════════════════

export type DispatchLine = {
  productId: string;
  qty: number;
  /** uuid ต่อบรรทัด (client สร้างตอนเพิ่ม) — idempotency key */
  lineKey: string;
};

export type DispatchTransferInput = {
  fromWarehouseId: string;
  destType: DcTransferDestType;
  /** ปลายทางเป็น DC warehouse (destType=WAREHOUSE) */
  toWarehouseId?: string;
  /** ปลายทางเป็นโมดูล (destType=MODULE) — ชื่อโมดูล เช่น "playland" */
  toModule?: string;
  toBranchId?: string;
  /** ป้ายปลายทางที่พิมพ์เอง (MODULE/สาขา) */
  toLabel?: string;
  /** ย้ายในไซต์เดียวกัน → รับเข้าทันที (เฉพาะ WAREHOUSE) */
  sameSite?: boolean;
  note?: string;
  lines: DispatchLine[];
};

export type DispatchTransferResult =
  | { ok: true; transferId: string; status: DcTransferStatus }
  | { ok: false; error: string };

/**
 * ส่งออก (จังหวะที่ 1): หักของจากต้นทาง + ดันเข้า in-transit + สร้างใบโอน.
 *  - ต้นทุนของแต่ละบรรทัด อ่านจาก movement ล่าสุดที่ต้นทาง แล้ว carry ลงใบ + movement TRANSFER_OUT
 *  - sameSite + ปลายทาง warehouse → รับเข้าทันที (auto-confirm) ในการเรียกเดียว
 *  - บรรทัดที่สต๊อกไม่พอ → คืน error (ทั้งใบ rollback แบบ best-effort: เราตรวจ onHand ก่อน)
 */
export async function dispatchTransfer(input: DispatchTransferInput): Promise<DispatchTransferResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const from = (input.fromWarehouseId ?? "").trim();
  if (!from) return { ok: false, error: "ยังไม่ได้เลือกคลังต้นทาง" };

  try {
    await assertWarehouseAllowed(session, from);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  const destType = input.destType;
  const toWarehouseId = (input.toWarehouseId ?? "").trim() || null;
  const toModule = (input.toModule ?? "").trim() || null;
  const toBranchId = (input.toBranchId ?? "").trim() || null;
  const toLabel = (input.toLabel ?? "").trim() || null;
  const sameSite = destType === DcTransferDestType.WAREHOUSE && !!input.sameSite && !!toWarehouseId;

  // ตรวจปลายทางสมเหตุสมผล
  if (destType === DcTransferDestType.WAREHOUSE) {
    if (!toWarehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลังปลายทาง" };
    if (toWarehouseId === from) return { ok: false, error: "คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน" };
    try {
      await assertWarehouseAllowed(session, toWarehouseId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังปลายทาง" };
    }
  } else {
    // MODULE: ต้องมีป้ายปลายทาง (label) หรือ module/branch อย่างน้อยหนึ่ง
    if (!toLabel && !toModule && !toBranchId) {
      return { ok: false, error: "ยังไม่ได้ระบุปลายทาง (สาขา/โมดูล)" };
    }
  }

  // กรอง + ดีดูปบรรทัด (qty>0, มี productId+lineKey, lineKey ไม่ซ้ำในใบ)
  const seen = new Set<string>();
  const lines = (input.lines ?? [])
    .filter((l) => l.productId && l.lineKey && Number.isFinite(l.qty) && l.qty > 0)
    .filter((l) => {
      if (seen.has(l.lineKey)) return false;
      seen.add(l.lineKey);
      return true;
    })
    .map((l) => ({ productId: l.productId, qty: Math.trunc(l.qty), lineKey: l.lineKey }));

  if (lines.length === 0) return { ok: false, error: "ยังไม่มีรายการส่งออก" };

  // ตรวจสต๊อกพอทุกบรรทัดก่อน (กันใบครึ่ง ๆ กลาง ๆ — ของหักไปบางบรรทัดแล้ว fail บรรทัดหลัง)
  for (const l of lines) {
    const onHand = await getOnHand(from, l.productId);
    if (l.qty > onHand) {
      return { ok: false, error: `สต๊อกไม่พอสำหรับบางรายการ (มี ${onHand} ต้องการ ${l.qty})` };
    }
  }

  // อ่านต้นทุนล่าสุดต่อบรรทัด (carry ตามของไป)
  const enriched = await Promise.all(
    lines.map(async (l) => {
      const cost = await latestCostAtSource(orgId, from, l.productId);
      return { ...l, unitCostSatang: cost.unitCostSatang, costLayerId: cost.costLayerId };
    }),
  );

  // สร้างใบโอน + บรรทัด (สถานะตาม sameSite)
  const tCode = transferCode();
  let transfer: { id: string };
  try {
    transfer = await prisma.dcTransfer.create({
      data: {
        orgId,
        transferCode: tCode,
        fromWarehouseId: from,
        destType,
        toWarehouseId: destType === DcTransferDestType.WAREHOUSE ? toWarehouseId : null,
        toModule: destType === DcTransferDestType.MODULE ? toModule : null,
        toBranchId: destType === DcTransferDestType.MODULE ? toBranchId : null,
        toLabel,
        status: sameSite ? DcTransferStatus.CONFIRMED : DcTransferStatus.IN_TRANSIT,
        sameSite,
        dispatchedByUserId: userId,
        ...(sameSite ? { confirmedByUserId: userId, confirmedAt: new Date() } : {}),
        note: (input.note ?? "").trim() || null,
        lines: {
          create: enriched.map((l) => ({
            orgId,
            productId: l.productId,
            qty: l.qty,
            unitCostSatang: l.unitCostSatang,
            costLayerId: l.costLayerId,
            // sameSite รับเข้าทันที → qtyReceived = qty (ครบ)
            ...(sameSite ? { qtyReceived: l.qty } : {}),
          })),
        },
      },
      select: { id: true },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างใบโอนไม่สำเร็จ" };
  }

  const transferId = transfer.id;

  // จังหวะที่ 1: TRANSFER_OUT ที่ต้นทาง (qty −n, inTransitDelta +n) — idempotent ต่อบรรทัด
  for (const l of enriched) {
    const res = await recordMovement({
      orgId,
      warehouseId: from,
      productId: l.productId,
      kind: DcMoveKind.TRANSFER_OUT,
      qty: -Math.abs(l.qty),
      inTransitDelta: Math.abs(l.qty),
      unitCostSatang: l.unitCostSatang,
      costLayerId: l.costLayerId,
      sourceKey: sourceKey("tfo", transferId, l.lineKey),
      refType: "dc_transfer",
      refId: transferId,
      note: `ส่งออก ${tCode}`,
      actorUserId: userId,
    });
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
  }

  // sameSite → รับเข้าปลายทางทันที (auto-confirm)
  if (sameSite && toWarehouseId) {
    for (const l of enriched) {
      // TRANSFER_IN ที่ปลายทาง (carry ต้นทุน)
      const inRes = await recordMovement({
        orgId,
        warehouseId: toWarehouseId,
        productId: l.productId,
        kind: DcMoveKind.TRANSFER_IN,
        qty: Math.abs(l.qty),
        unitCostSatang: l.unitCostSatang,
        costLayerId: l.costLayerId,
        sourceKey: sourceKey("tfi", transferId, l.lineKey),
        refType: "dc_transfer",
        refId: transferId,
        note: `รับโอน ${tCode} (อยู่ที่เดียวกัน)`,
        actorUserId: userId,
      });
      if (!inRes.ok) return { ok: false, error: inRes.error };

      // ลด in-transit ของต้นทาง
      await decrementSourceInTransit(from, l.productId, Math.abs(l.qty));
    }
  }

  return { ok: true, transferId, status: sameSite ? DcTransferStatus.CONFIRMED : DcTransferStatus.IN_TRANSIT };
}

/** ลด qtyInTransit ของ balance ต้นทางลง n (floor ที่ 0 กัน negative). */
async function decrementSourceInTransit(warehouseId: string, productId: string, n: number): Promise<void> {
  const bal = await prisma.dcStockBalance.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
    select: { id: true, qtyInTransit: true },
  });
  if (!bal) return;
  const next = Math.max(0, (bal.qtyInTransit ?? 0) - n);
  await prisma.dcStockBalance.update({ where: { id: bal.id }, data: { qtyInTransit: next } });
}

// ════════════════════════════════════════════════════════════════════
// confirm (ปลายทางรับ — 1 tap หรือ รายบรรทัดถ้าไม่ครบ)
// ════════════════════════════════════════════════════════════════════

export type ConfirmTransferInput = {
  transferId: string;
  /** ถ้าไม่ส่ง → รับครบทุกบรรทัดตามที่ส่งออก (1-tap "ครบ") */
  lines?: { lineId: string; qtyReceived: number }[];
};

export type ConfirmTransferResult = { ok: true } | { ok: false; error: string };

/**
 * ยืนยันปลายทางรับ (จังหวะที่ 2). idempotent — ถ้าใบ CONFIRMED/AUTO_UNVERIFIED แล้ว คืน ok เลย.
 *  - WAREHOUSE dest → ทุกบรรทัด: TRANSFER_IN ที่ปลายทาง (carry ต้นทุน) + ลด in-transit ต้นทาง
 *  - MODULE dest → ปิดใบเฉย ๆ (ลด in-transit ต้นทาง · ไม่เขียนเข้าตารางโมดูลอื่น — PHASE 3)
 *  - ตั้งสถานะ CONFIRMED + confirmedBy/At · บันทึก qtyReceived รายบรรทัด
 */
export async function confirmTransfer(input: ConfirmTransferInput): Promise<ConfirmTransferResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ยืนยันรับโอน (ต้องเป็นหลังบ้าน)" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const transferId = (input.transferId ?? "").trim();
  if (!transferId) return { ok: false, error: "ไม่พบใบโอน" };

  const transfer = await prisma.dcTransfer.findFirst({
    where: { id: transferId, orgId },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      destType: true,
      toWarehouseId: true,
      status: true,
      lines: {
        select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true },
      },
    },
  });
  if (!transfer) return { ok: false, error: "ไม่พบใบโอน" };

  // idempotent — ปิดไปแล้วก็ถือว่าสำเร็จ
  if (transfer.status === DcTransferStatus.CONFIRMED || transfer.status === DcTransferStatus.AUTO_UNVERIFIED) {
    return { ok: true };
  }
  if (transfer.status === DcTransferStatus.CANCELLED) {
    return { ok: false, error: "ใบนี้ถูกยกเลิกแล้ว" };
  }

  // map qtyReceived ที่ส่งมา (รายบรรทัด) → default = qty เต็ม (รับครบ)
  const recvByLine = new Map<string, number>();
  for (const r of input.lines ?? []) {
    if (r.lineId && Number.isFinite(r.qtyReceived)) {
      recvByLine.set(r.lineId, Math.max(0, Math.trunc(r.qtyReceived)));
    }
  }

  const isWarehouseDest = transfer.destType === DcTransferDestType.WAREHOUSE && !!transfer.toWarehouseId;
  const destWh = transfer.toWarehouseId;

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const received = recvByLine.has(line.id) ? (recvByLine.get(line.id) as number) : line.qty;

        // บันทึก qtyReceived รายบรรทัด
        await tx.dcTransferLine.update({
          where: { id: line.id },
          data: { qtyReceived: received },
        });
      }
    });

    // movement + balance ทำนอก tx ของ line-update เพื่อใช้ recordMovement (มี tx ของตัวเอง · idempotent)
    if (isWarehouseDest && destWh) {
      for (const line of transfer.lines) {
        const received = recvByLine.has(line.id) ? (recvByLine.get(line.id) as number) : line.qty;
        if (received > 0) {
          const inRes = await recordMovement({
            orgId,
            warehouseId: destWh,
            productId: line.productId,
            kind: DcMoveKind.TRANSFER_IN,
            qty: received,
            unitCostSatang: line.unitCostSatang,
            costLayerId: line.costLayerId,
            sourceKey: sourceKey("tfi", transferId, line.id),
            refType: "dc_transfer",
            refId: transferId,
            note: `รับโอน ${transfer.transferCode}`,
            actorUserId: userId,
          });
          if (!inRes.ok) throw new Error(inRes.error);
        }
        // ลด in-transit ต้นทาง ตามจำนวนที่ "ส่งออก" (qty) — ของออกจาก in-transit ครบ
        // (ส่วนต่าง qty−received คือของหาย/เสียหาย: ออกจาก in-transit แต่ไม่เข้าปลายทาง)
        await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
      }
    } else {
      // MODULE dest → ปิดใบเฉย ๆ: ลด in-transit ต้นทาง (ไม่เขียนเข้าโมดูลอื่น — PHASE 3)
      for (const line of transfer.lines) {
        await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
      }
    }

    await prisma.dcTransfer.update({
      where: { id: transferId },
      data: {
        status: DcTransferStatus.CONFIRMED,
        confirmedByUserId: userId,
        confirmedAt: new Date(),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยืนยันรับโอนไม่สำเร็จ" };
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
// cancel (ยกเลิก — คืนของกลับต้นทาง)
// ════════════════════════════════════════════════════════════════════

export type CancelTransferResult = { ok: true } | { ok: false; error: string };

/**
 * ยกเลิกใบโอน — ได้เฉพาะที่ยังไม่ปิด (IN_TRANSIT/DISPATCHED).
 * คืนของกลับ qtyOnHand ต้นทาง + ลด in-transit ต้นทาง (กลับสภาพก่อนส่ง) + สถานะ CANCELLED.
 */
export async function cancelTransfer(transferId: string): Promise<CancelTransferResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ยกเลิกใบโอน" };
  const orgId = session.user.org_id;
  const userId = session.user.id;

  const id = (transferId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบโอน" };

  const transfer = await prisma.dcTransfer.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      status: true,
      lines: { select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true } },
    },
  });
  if (!transfer) return { ok: false, error: "ไม่พบใบโอน" };

  if (transfer.status !== DcTransferStatus.IN_TRANSIT && transfer.status !== DcTransferStatus.DISPATCHED) {
    return { ok: false, error: "ยกเลิกได้เฉพาะใบที่ยังกำลังส่ง (ยังไม่ปิด)" };
  }

  try {
    // คืนของกลับต้นทาง: RETURN_IN (qty +n) + ลด in-transit −n · idempotent ต่อบรรทัด
    for (const line of transfer.lines) {
      const back = await recordMovement({
        orgId,
        warehouseId: transfer.fromWarehouseId,
        productId: line.productId,
        kind: DcMoveKind.RETURN_IN,
        qty: Math.abs(line.qty),
        inTransitDelta: -Math.abs(line.qty),
        unitCostSatang: line.unitCostSatang,
        costLayerId: line.costLayerId,
        sourceKey: sourceKey("tfcancel", id, line.id),
        refType: "dc_transfer_cancel",
        refId: id,
        note: `ยกเลิกใบโอน ${transfer.transferCode} — คืนของกลับคลัง`,
        actorUserId: userId,
      });
      if (!back.ok) throw new Error(back.error);
    }

    await prisma.dcTransfer.update({
      where: { id },
      data: { status: DcTransferStatus.CANCELLED },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกใบโอนไม่สำเร็จ" };
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
// autoPromoteStaleTransfers (เรียกจาก reconcile job)
// ════════════════════════════════════════════════════════════════════

export type AutoPromoteResult = {
  ok: true;
  promotedWarehouse: number;
  promotedModule: number;
};

/**
 * ใบ IN_TRANSIT ที่ค้างเกิน N ชม. → ปิดอัตโนมัติแบบ "ติดธง" (ไม่หายเงียบ ๆ):
 *   • WAREHOUSE dest → รับเข้าปลายทางอัตโนมัติ (TRANSFER_IN ครบตาม qty) + ลด in-transit + status=AUTO_UNVERIFIED
 *   • MODULE dest    → ปิด in-transit + status=AUTO_UNVERIFIED (ไม่เขียนเข้าโมดูลอื่น)
 * EXPORT — reconcile job เรียกตัวนี้. ไม่ต้องมี session (system job) → scope ด้วย orgId ที่ส่งมา.
 */
export async function autoPromoteStaleTransfers(
  orgId: string,
  olderThanHours = 48,
): Promise<AutoPromoteResult> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const stale = await prisma.dcTransfer.findMany({
    where: {
      orgId,
      status: DcTransferStatus.IN_TRANSIT,
      dispatchedAt: { lt: cutoff },
    },
    select: {
      id: true,
      transferCode: true,
      fromWarehouseId: true,
      destType: true,
      toWarehouseId: true,
      lines: { select: { id: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true } },
    },
  });

  let promotedWarehouse = 0;
  let promotedModule = 0;

  for (const transfer of stale) {
    const isWarehouseDest = transfer.destType === DcTransferDestType.WAREHOUSE && !!transfer.toWarehouseId;
    const destWh = transfer.toWarehouseId;

    try {
      if (isWarehouseDest && destWh) {
        for (const line of transfer.lines) {
          const inRes = await recordMovement({
            orgId,
            warehouseId: destWh,
            productId: line.productId,
            kind: DcMoveKind.TRANSFER_IN,
            qty: Math.abs(line.qty),
            unitCostSatang: line.unitCostSatang,
            costLayerId: line.costLayerId,
            sourceKey: sourceKey("tfi", transfer.id, line.id),
            refType: "dc_transfer_auto",
            refId: transfer.id,
            note: `รับโอนอัตโนมัติ ${transfer.transferCode} (ค้างเกิน ${olderThanHours} ชม.)`,
            actorUserId: null,
          });
          if (!inRes.ok) throw new Error(inRes.error);
          await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
          await prisma.dcTransferLine.update({
            where: { id: line.id },
            data: { qtyReceived: line.qty },
          });
        }
        promotedWarehouse += 1;
      } else {
        for (const line of transfer.lines) {
          await decrementSourceInTransit(transfer.fromWarehouseId, line.productId, line.qty);
        }
        promotedModule += 1;
      }

      await prisma.dcTransfer.update({
        where: { id: transfer.id },
        data: {
          status: DcTransferStatus.AUTO_UNVERIFIED,
          confirmedAt: new Date(),
        },
      });
    } catch {
      // ใบนี้พลาด → ข้ามไปทำใบถัดไป (ไม่ทำให้ทั้ง job ล้ม)
      continue;
    }
  }

  return { ok: true, promotedWarehouse, promotedModule };
}
