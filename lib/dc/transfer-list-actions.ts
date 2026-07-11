"use server";

// DC Warehouse · FLOOR "ใบที่ฉันส่ง / รอรับเข้า" (transfer list) — server actions.
//
// หน้าไล่ดูใบโอนสำหรับพนักงานหน้างานบนมือถือ:
//   • listMyOutgoingTransfers — ใบที่ "ส่งออกจากคลังนี้" (fromWarehouseId = คลังที่ทำงาน)
//   • listIncomingTransfers   — ใบที่ "มีของเข้ามารอรับ" (toWarehouseId = คลังนี้ · IN_TRANSIT · WAREHOUSE dest)
//
// READ-ONLY: ไม่มีการเขียน/ขยับสต๊อก/ต้นทุนในไฟล์นี้เลย — pure SELECT.
// gate ด้วย requireSession + canDcFloor + assertWarehouseAllowed → ผู้ใช้เห็นได้เฉพาะ
// คลังที่ตัวเองผูกสิทธิ์ (bound) เท่านั้น (กันดูใบของไซต์อื่นด้วยการเดา warehouseId).

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";

export type TransferListRow = {
  id: string;
  transferCode: string;
  status: string;
  dispatchedAt: string | null; // ISO — client จัด format เอง
  confirmedAt: string | null; // ISO
  /** ป้ายปลายทาง (ชื่อคลัง/สาขา/โมดูล) — ใช้ในฝั่ง "ส่งออก" */
  destLabel: string;
  /** ชื่อคลังต้นทาง — ใช้ในฝั่ง "รอรับเข้า" */
  fromLabel: string;
  lineCount: number;
  firstImageUrl: string | null;
  /** true ถ้าคนที่กำลังดูเป็นคนกดส่งใบนี้เอง (hint "ฉันส่งเอง") */
  dispatchedByMe: boolean;
};

export type ListTransfersResult =
  | { ok: true; rows: TransferListRow[] }
  | { ok: false; error: string };

// resolve R2 key → URL เต็มฝั่ง server (client อ่าน env ไม่ได้) — pattern เดียวกับ
// floor-products-actions.ts / transfer-actions.ts
function makeImageResolver(): (key: string | null | undefined) => string | null {
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  return (key) =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
}

/**
 * ใบที่ "ส่งออกจากคลังนี้" (fromWarehouseId = คลังที่กำลังทำงาน) — ทุกสถานะ เรียงส่งล่าสุดก่อน.
 * scope: orgId + warehouse (assertWarehouseAllowed) · take ~100.
 */
export async function listMyOutgoingTransfers(input: {
  warehouseId: string;
  q?: string;
  limit?: number;
}): Promise<ListTransfersResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const warehouseId = (input.warehouseId ?? "").trim();
    if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };
    await assertWarehouseAllowed(session, warehouseId);
    const orgId = session.user.org_id;

    const q = (input.q ?? "").trim();
    const take = Math.min(Math.max(input.limit ?? 100, 1), 200);

    const transfers = await prisma.dcTransfer.findMany({
      where: {
        orgId,
        fromWarehouseId: warehouseId,
        ...(q ? { transferCode: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { dispatchedAt: "desc" },
      take,
      select: {
        id: true,
        transferCode: true,
        status: true,
        destType: true,
        toWarehouseId: true,
        toLabel: true,
        dispatchedAt: true,
        confirmedAt: true,
        dispatchedByUserId: true,
        _count: { select: { lines: true } },
        lines: {
          take: 1,
          select: { product: { select: { imageR2Path: true } } },
        },
      },
    });

    // ชื่อคลัง (ต้นทาง = คลังนี้ + ปลายทางที่เป็น warehouse)
    const whIds = new Set<string>([warehouseId]);
    for (const t of transfers) if (t.toWarehouseId) whIds.add(t.toWarehouseId);
    const warehouses = await prisma.dcWarehouse.findMany({
      where: { id: { in: [...whIds] }, orgId },
      select: { id: true, name: true },
    });
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));
    const fromName = whName.get(warehouseId) ?? "คลังต้นทาง";

    const toImageUrl = makeImageResolver();

    const rows: TransferListRow[] = transfers.map((t) => {
      const destLabel =
        t.destType === DcTransferDestType.WAREHOUSE && t.toWarehouseId
          ? whName.get(t.toWarehouseId) ?? "คลังปลายทาง"
          : t.toLabel ?? "สาขา/โมดูล";
      return {
        id: t.id,
        transferCode: t.transferCode,
        status: t.status,
        dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
        confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
        destLabel,
        fromLabel: fromName,
        lineCount: t._count.lines,
        firstImageUrl: toImageUrl(t.lines[0]?.product?.imageR2Path),
        dispatchedByMe: t.dispatchedByUserId === session.user.id,
      };
    });

    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบโอนไม่สำเร็จ" };
  }
}

/**
 * ใบที่ "มีของเข้ามารอรับ" ที่คลังนี้ (toWarehouseId = คลังนี้ · WAREHOUSE dest · IN_TRANSIT).
 * feed สำหรับ "รอรับเข้า" — พนักงานหน้างานกดรับได้ (ล็อกตามคลังที่ผูกสิทธิ์).
 * scope: orgId + warehouse (assertWarehouseAllowed) · take ~100.
 */
export async function listIncomingTransfers(input: {
  warehouseId: string;
  limit?: number;
}): Promise<ListTransfersResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const warehouseId = (input.warehouseId ?? "").trim();
    if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };
    await assertWarehouseAllowed(session, warehouseId);
    const orgId = session.user.org_id;

    const take = Math.min(Math.max(input.limit ?? 100, 1), 200);

    const transfers = await prisma.dcTransfer.findMany({
      where: {
        orgId,
        toWarehouseId: warehouseId,
        destType: DcTransferDestType.WAREHOUSE,
        status: DcTransferStatus.IN_TRANSIT,
      },
      orderBy: { dispatchedAt: "desc" },
      take,
      select: {
        id: true,
        transferCode: true,
        status: true,
        fromWarehouseId: true,
        dispatchedAt: true,
        confirmedAt: true,
        dispatchedByUserId: true,
        _count: { select: { lines: true } },
        lines: {
          take: 1,
          select: { product: { select: { imageR2Path: true } } },
        },
      },
    });

    // ชื่อคลัง (ปลายทาง = คลังนี้ + ต้นทางแต่ละใบ)
    const whIds = new Set<string>([warehouseId]);
    for (const t of transfers) whIds.add(t.fromWarehouseId);
    const warehouses = await prisma.dcWarehouse.findMany({
      where: { id: { in: [...whIds] }, orgId },
      select: { id: true, name: true },
    });
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));
    const destName = whName.get(warehouseId) ?? "คลังปลายทาง";

    const toImageUrl = makeImageResolver();

    const rows: TransferListRow[] = transfers.map((t) => ({
      id: t.id,
      transferCode: t.transferCode,
      status: t.status,
      dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
      confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
      destLabel: destName,
      fromLabel: whName.get(t.fromWarehouseId) ?? "คลังต้นทาง",
      lineCount: t._count.lines,
      firstImageUrl: toImageUrl(t.lines[0]?.product?.imageR2Path),
      dispatchedByMe: t.dispatchedByUserId === session.user.id,
    }));

    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการรอรับไม่สำเร็จ" };
  }
}
