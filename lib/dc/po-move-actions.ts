"use server";

// DC · server actions สำหรับ "โอน/เบิก เป็นใบ PO" (ให้ client picker เรียก).
// ห่อ query ใน po-fulfillment.ts ด้วย session + org-scope + สิทธิ์หน้าคลัง.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import {
  getPoFulfillment,
  listReceivablePosForMove,
  type PoFulfillment,
  type ReceivablePoForMove,
} from "@/lib/dc/po-fulfillment";

export type ListPosForMoveResult =
  | { ok: true; pos: ReceivablePoForMove[] }
  | { ok: false; error: string };

/** รายการใบ PO ที่รับเข้าคลังแล้ว (ให้เลือกตอนโอน/เบิกเป็นใบ). ระบุคลัง = เฉพาะใบที่รับเข้าคลังนั้น. */
export async function listPosForMoveAction(warehouseId?: string): Promise<ListPosForMoveResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  // ต้องระบุคลัง + ตรวจสิทธิ์เสมอ (กันอ่านใบ PO ข้ามคลังที่ไม่ได้รับมอบหมาย)
  const wh = (warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ต้องระบุคลัง" };
  try {
    await assertWarehouseAllowed(session, wh);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  try {
    const pos = await listReceivablePosForMove(orgId, wh);
    return { ok: true, pos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบ PO ไม่สำเร็จ" };
  }
}

export type GetPoFulfillmentResult =
  | { ok: true; data: PoFulfillment }
  | { ok: false; error: string };

/** รายละเอียดใบ PO: ต่อสินค้า สั่ง/รับเข้า/โอนออก/เหลือในใบ/คงเหลือจริง (onHand ที่คลังที่ระบุ). */
export async function getPoFulfillmentAction(
  poId: string,
  warehouseId?: string,
): Promise<GetPoFulfillmentResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const id = (poId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบ PO" };

  // ต้องระบุคลัง + ตรวจสิทธิ์เสมอ (กันอ่านใบ PO/คงเหลือ ข้ามคลังที่ไม่ได้รับมอบหมาย)
  const wh = (warehouseId ?? "").trim();
  if (!wh) return { ok: false, error: "ต้องระบุคลัง" };
  try {
    await assertWarehouseAllowed(session, wh);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  try {
    const data = await getPoFulfillment(orgId, id, { warehouseId: wh });
    if (!data) return { ok: false, error: "ไม่พบใบ PO" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดใบ PO ไม่สำเร็จ" };
  }
}
