// DC Warehouse · CORE stock-movement engine.
//
// ★ The single primitive every floor/office op goes through. Guarantees:
//   1. IDEMPOTENCY — @@unique([orgId, sourceKey]) at the DB; a retry/double-tap
//      with the same sourceKey is a no-op (returns duplicate:true). The locked
//      precondition from the workshop (PlaylandStockMovement's missing key was
//      the bug we must not repeat).
//   2. NO NEGATIVE — an ISSUE/TRANSFER_OUT that would drive qtyOnHand < 0 throws
//      (unless allowNegative). Enforced inside the transaction.
//   3. ATOMIC — balance update + ledger row in one $transaction.
//   ZERO-COST-COLUMN: balances carry NO cost; unitCostSatang on the movement is
//   only an operational snapshot from the cost-layer, never a recomputed average.

import { prisma } from "@/lib/prisma";
import { DcMoveKind, DcPostStatus } from "@/lib/generated/prisma/enums";

function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

export type RecordMovementInput = {
  orgId: string;
  warehouseId: string;
  productId: string;
  kind: DcMoveKind;
  /** signed: +in / -out / 0 for MOVE (location-only) */
  qty: number;
  /** idempotency key — unique per org; reuse the SAME key on retries */
  sourceKey: string;
  unitCostSatang?: number | null;
  costLayerId?: string | null;
  refType?: string | null;
  refId?: string | null;
  /**
   * Pinpoint #2 — ผูก movement source-outbound (ISSUE/TRANSFER_OUT) หรือ reversal (RETURN_IN)
   * กับ "ใบ PO" เพื่อให้ getPoFulfillment นับ movedOut ต่อใบได้ (โอน/เบิกจากหลายใบ).
   * ★ ตั้งเฉพาะ source-out + reversal เท่านั้น · ห้ามตั้งบน TRANSFER_IN ปลายทาง.
   */
  poId?: string | null;
  note?: string | null;
  locationFrom?: string | null;
  locationTo?: string | null;
  actorUserId?: string | null;
  postStatus?: DcPostStatus;
  /** also adjust qtyInTransit (e.g. transfer-out: -qty onHand, +qty inTransit) */
  inTransitDelta?: number;
  allowNegative?: boolean;
};

export type RecordMovementResult =
  | { ok: true; movementId: string; duplicate: boolean; balanceAfter: number }
  | { ok: false; error: string };

export async function recordMovement(input: RecordMovementInput): Promise<RecordMovementResult> {
  const inTransitDelta = input.inTransitDelta ?? 0;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.dcStockMovement.findUnique({
        where: { orgId_sourceKey: { orgId: input.orgId, sourceKey: input.sourceKey } },
        select: { id: true, balanceAfter: true },
      });
      if (existing) {
        return { ok: true as const, movementId: existing.id, duplicate: true, balanceAfter: existing.balanceAfter ?? 0 };
      }

      const bal = await tx.dcStockBalance.findUnique({
        where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
        select: { id: true, qtyOnHand: true, qtyInTransit: true, location: true },
      });
      const current = bal?.qtyOnHand ?? 0;
      const next = current + input.qty;
      if (next < 0 && !input.allowNegative) {
        throw new Error(`สต๊อกไม่พอ (มี ${current} ต้องการ ${Math.abs(input.qty)})`);
      }
      const nextInTransit = Math.max(0, (bal?.qtyInTransit ?? 0) + inTransitDelta);

      if (bal) {
        await tx.dcStockBalance.update({
          where: { id: bal.id },
          data: {
            qtyOnHand: next,
            qtyInTransit: nextInTransit,
            ...(input.locationTo ? { location: input.locationTo } : {}),
          },
        });
      } else {
        await tx.dcStockBalance.create({
          data: {
            orgId: input.orgId,
            warehouseId: input.warehouseId,
            productId: input.productId,
            qtyOnHand: next,
            qtyInTransit: nextInTransit,
            location: input.locationTo ?? null,
          },
        });
      }

      const mv = await tx.dcStockMovement.create({
        data: {
          orgId: input.orgId,
          warehouseId: input.warehouseId,
          productId: input.productId,
          kind: input.kind,
          qty: input.qty,
          balanceAfter: next,
          unitCostSatang: input.unitCostSatang ?? null,
          costLayerId: input.costLayerId ?? null,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          poId: input.poId ?? null,
          sourceKey: input.sourceKey,
          postStatus: input.postStatus ?? DcPostStatus.NA,
          note: input.note ?? null,
          locationFrom: input.locationFrom ?? null,
          locationTo: input.locationTo ?? null,
          actorUserId: input.actorUserId ?? null,
        },
        select: { id: true },
      });
      return { ok: true as const, movementId: mv.id, duplicate: false, balanceAfter: next };
    });
  } catch (e) {
    if (errCode(e) === "P2002") {
      const existing = await prisma.dcStockMovement.findUnique({
        where: { orgId_sourceKey: { orgId: input.orgId, sourceKey: input.sourceKey } },
        select: { id: true, balanceAfter: true },
      });
      if (existing) {
        return { ok: true, movementId: existing.id, duplicate: true, balanceAfter: existing.balanceAfter ?? 0 };
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกการเคลื่อนไหวล้มเหลว" };
  }
}

/** Look up a product by barcode OR sku within an org (scan/search). */
export async function findProductByCode(orgId: string, code: string) {
  const c = code.trim();
  if (!c) return null;
  return prisma.dcProduct.findFirst({
    where: { orgId, active: true, OR: [{ barcode: c }, { sku: c }] },
    select: { id: true, sku: true, name: true, barcode: true, type: true, unit: true, imageR2Path: true },
  });
}

/** Current on-hand for a product in a warehouse (0 if none). */
export async function getOnHand(warehouseId: string, productId: string): Promise<number> {
  const b = await prisma.dcStockBalance.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
    select: { qtyOnHand: true },
  });
  return b?.qtyOnHand ?? 0;
}
