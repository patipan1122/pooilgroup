"use server";

// DC · ใบโอน — โหลด "รายละเอียดหัวใบ + บรรทัดสินค้า" สำหรับ inline-expand ในลิสต์ (floor + office).
//
// READ-ONLY: ไม่มีการเขียน/ขยับสต๊อก/ต้นทุนในไฟล์นี้เลย — pure SELECT.
// ใช้ตอนผู้ใช้กด "กาง" แถวใบโอนในหน้าลิสต์ → เรียก getTransferDetail(id) ครั้งเดียว (lazy) →
// คืน object แบน ๆ (serializable) ให้ client เรนเดอร์ตารางบรรทัด (รูป + ชื่อ + จำนวนส่ง/รับ + สถานะ).
//
// SCOPE/AUTH: replicate จากหน้ารายละเอียด floor (transfers/[id]/page.tsx) — กันเดา id เปิดใบข้ามไซต์:
//   1) requireSession + canDcFloor (ทุก role ที่เข้าหน้าลิสต์ได้ผ่านด่านนี้)
//   2) findFirst where { id, orgId }  → ล็อกองค์กร
//   3) from- หรือ to-warehouse ต้อง ∈ คลังที่ผู้ใช้ผูกสิทธิ์ (getAllowedWarehouses)
//      → admin/manager เห็นทุกคลัง · staff เห็นเฉพาะคลังที่ bound.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { getAllowedWarehouses } from "@/lib/dc/access";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";

/** บรรทัดสินค้าในใบโอน (สำหรับ inline-expand — ไม่มีต้นทุน, แสดงผลอย่างเดียว). */
export type TransferDetailLine = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  qtyReceived: number | null;
  imageUrl: string | null;
};

/** หัวใบ + บรรทัด — object แบน serializable ส่งข้าม server→client ได้. */
export type TransferDetail = {
  id: string;
  transferCode: string;
  status: string;
  statusLabel: string;
  fromName: string;
  destName: string;
  dispatchedAt: string | null; // ISO — client จัด format เอง
  confirmedAt: string | null; // ISO
  note: string | null;
  lines: TransferDetailLine[];
};

export type GetTransferDetailResult =
  | { ok: true; detail: TransferDetail }
  | { ok: false; error: string };

// resolve R2 key → URL เต็มฝั่ง server (client อ่าน env ไม่ได้) — pattern เดียวกับ
// transfer-list-actions.ts / office/transfers/[id]/page.tsx
function makeImageResolver(): (key: string | null | undefined) => string | null {
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  return (key) =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
}

/**
 * โหลดรายละเอียดใบโอน (หัวใบ + บรรทัดสินค้า) สำหรับ inline-expand ในลิสต์.
 * gate: session + canDcFloor + warehouse-scope (from/to ∈ คลังที่ผูกสิทธิ์).
 */
export async function getTransferDetail(transferId: string): Promise<GetTransferDetailResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอน" };
    const id = (transferId ?? "").trim();
    if (!id) return { ok: false, error: "ไม่พบใบโอน" };
    const orgId = session.user.org_id;

    const transfer = await prisma.dcTransfer.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        transferCode: true,
        status: true,
        destType: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        toLabel: true,
        dispatchedAt: true,
        confirmedAt: true,
        note: true,
        lines: {
          orderBy: { id: "asc" },
          select: { id: true, productId: true, qty: true, qtyReceived: true },
        },
      },
    });
    if (!transfer) return { ok: false, error: "ไม่พบใบโอน" };

    // ── SCOPE GATE: from- หรือ to-warehouse ต้อง ∈ คลังที่ผู้ใช้ผูกสิทธิ์ ──
    // (กันเดา id เปิดดูใบของคลัง/ไซต์ที่ไม่ได้รับมอบหมาย — เหมือน transfers/[id]/page.tsx)
    const allowed = await getAllowedWarehouses(session);
    const allowedIds = new Set(allowed.map((w) => w.id));
    const inScope =
      allowedIds.has(transfer.fromWarehouseId) ||
      (!!transfer.toWarehouseId && allowedIds.has(transfer.toWarehouseId));
    if (!inScope) return { ok: false, error: "ไม่มีสิทธิ์ดูใบโอนนี้" };

    // ชื่อคลัง (ต้นทาง + ปลายทาง warehouse)
    const whIds = [transfer.fromWarehouseId, transfer.toWarehouseId].filter(Boolean) as string[];
    const warehouses = whIds.length
      ? await prisma.dcWarehouse.findMany({
          where: { id: { in: whIds }, orgId },
          select: { id: true, name: true },
        })
      : [];
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));

    // ชื่อ/รูปสินค้ารายบรรทัด
    const productIds = [...new Set(transfer.lines.map((l) => l.productId))];
    const products = productIds.length
      ? await prisma.dcProduct.findMany({
          where: { id: { in: productIds }, orgId },
          select: { id: true, sku: true, name: true, unit: true, imageR2Path: true },
        })
      : [];
    const prodById = new Map(products.map((p) => [p.id, p]));

    const toImageUrl = makeImageResolver();

    const destName =
      transfer.destType === DcTransferDestType.WAREHOUSE && transfer.toWarehouseId
        ? whName.get(transfer.toWarehouseId) ?? "คลังปลายทาง"
        : transfer.toLabel ?? "สาขา/โมดูล";

    const detail: TransferDetail = {
      id: transfer.id,
      transferCode: transfer.transferCode,
      status: transfer.status,
      statusLabel: TRANSFER_STATUS_LABEL[transfer.status] ?? transfer.status,
      fromName: whName.get(transfer.fromWarehouseId) ?? "คลังต้นทาง",
      destName,
      dispatchedAt: transfer.dispatchedAt ? transfer.dispatchedAt.toISOString() : null,
      confirmedAt: transfer.confirmedAt ? transfer.confirmedAt.toISOString() : null,
      note: transfer.note,
      lines: transfer.lines.map((l) => {
        const p = prodById.get(l.productId);
        return {
          id: l.id,
          sku: p?.sku ?? "—",
          name: p?.name ?? l.productId,
          unit: p?.unit ?? "ชิ้น",
          qty: l.qty,
          qtyReceived: l.qtyReceived,
          imageUrl: toImageUrl(p?.imageR2Path),
        };
      }),
    };

    return { ok: true, detail };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายละเอียดใบโอนไม่สำเร็จ" };
  }
}
