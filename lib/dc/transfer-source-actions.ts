"use server";

// DC · server actions สำหรับ "โอน/เบิก จากใบโอนที่รับเข้าคลัง" (ให้ client picker เรียก).
// ห่อ query ใน transfer-source.ts ด้วย session + org-scope + สิทธิ์หน้าคลัง (เหมือน po-move-actions).

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import {
  getReceivedTransferDetail,
  listReceivedTransfersForMove,
  type ReceivedTransferForMove,
  type TransferSourceDetail,
} from "@/lib/dc/transfer-source";

export type ListReceivedTransfersResult =
  | { ok: true; transfers: ReceivedTransferForMove[] }
  | { ok: false; error: string };

/** รายการใบโอนที่รับเข้าคลังนี้แล้ว (ให้เลือกตอนโอน/เบิกต่อ). ต้องระบุคลัง + ตรวจสิทธิ์เสมอ. */
export async function listReceivedTransfersForMoveAction(
  warehouseId?: string,
): Promise<ListReceivedTransfersResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const wh = (warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ต้องระบุคลัง" };
  try {
    await assertWarehouseAllowed(session, wh);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  try {
    const transfers = await listReceivedTransfersForMove(orgId, { warehouseId: wh });
    return { ok: true, transfers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบโอนไม่สำเร็จ" };
  }
}

export type GetReceivedTransferResult =
  | { ok: true; data: TransferSourceDetail }
  | { ok: false; error: string };

/** รายละเอียดใบโอน: ต่อสินค้า รับเข้า/คงเหลือจริง/พรีฟิลได้ (onHand ที่คลังที่ระบุ). */
export async function getReceivedTransferDetailAction(
  transferId: string,
  warehouseId?: string,
): Promise<GetReceivedTransferResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const id = (transferId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบโอน" };

  const wh = (warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ต้องระบุคลัง" };
  try {
    await assertWarehouseAllowed(session, wh);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  try {
    const data = await getReceivedTransferDetail(orgId, id, { warehouseId: wh });
    if (!data) return { ok: false, error: "ไม่พบใบโอน" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดใบโอนไม่สำเร็จ" };
  }
}
