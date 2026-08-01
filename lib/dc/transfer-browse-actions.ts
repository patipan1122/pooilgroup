"use server";

// DC · server actions สำหรับ office "ดูสินค้าตามใบโอน" (read-only browse).
//   คู่ขนานกับ listOfficePosForBrowse/getOfficePoFulfillment แต่ฝั่งใบโอน.
//   ห่อ query ใน transfer-fulfillment.ts ด้วย session + org-scope + สิทธิ์หน้าคลัง.
//   ไม่ระบุ warehouseId → รวมเฉพาะ "คลังที่ user มีสิทธิ์เห็น" (getAllowedWarehouses) — ไม่ query ข้ามสิทธิ์.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed, getAllowedWarehouses } from "@/lib/dc/access";
import {
  getTransferFulfillment,
  listReceivedTransfersForBrowse,
  type TransferFulfillment,
  type ReceivedTransferForBrowse,
} from "@/lib/dc/transfer-fulfillment";

export type ListTransfersForBrowseResult =
  | { ok: true; transfers: ReceivedTransferForBrowse[] }
  | { ok: false; error: string };

/** office: ใบโอนที่รับเข้าคลังแล้ว — เจาะจงคลังปลายทาง หรือ "รวมทุกคลังที่มีสิทธิ์" (wh ว่าง). */
export async function listOfficeTransfersForBrowse(warehouseId?: string): Promise<ListTransfersForBrowseResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;
  const wh = (warehouseId ?? "").trim();

  try {
    if (wh) {
      await assertWarehouseAllowed(session, wh);
      const transfers = await listReceivedTransfersForBrowse(orgId, { warehouseId: wh });
      return { ok: true, transfers };
    }
    const ids = (await getAllowedWarehouses(session)).map((w) => w.id);
    if (ids.length === 0) return { ok: true, transfers: [] };
    const transfers = await listReceivedTransfersForBrowse(orgId, { warehouseIds: ids });
    return { ok: true, transfers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบโอนไม่สำเร็จ" };
  }
}

export type GetTransferFulfillmentResult =
  | { ok: true; data: TransferFulfillment }
  | { ok: false; error: string };

/** office: รายละเอียดใบโอน — ต่อสินค้า โอนมา/รับ/คงเหลือจริง (onHand ที่คลังปลายทาง). */
export async function getOfficeTransferFulfillment(transferId: string): Promise<GetTransferFulfillmentResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const id = (transferId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบโอน" };

  try {
    const data = await getTransferFulfillment(orgId, id);
    if (!data) return { ok: false, error: "ไม่พบใบโอน" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดใบโอนไม่สำเร็จ" };
  }
}
