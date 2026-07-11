"use server";

// DC · server actions สำหรับ "โอน/เบิก เป็นใบ PO" (ให้ client picker เรียก).
// ห่อ query ใน po-fulfillment.ts ด้วย session + org-scope + สิทธิ์หน้าคลัง.

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed, getAllowedWarehouses } from "@/lib/dc/access";
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
    const pos = await listReceivablePosForMove(orgId, { warehouseId: wh });
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

// ── Office read-only browse (Pinpoint #2 fix · 2026-07-11) ──────────────
//   หน้า office "ดูตามใบ PO" ให้ดู "รวมทุกคลัง" ได้ (ต่างจากหน้าคลังที่ต้องเจาะจงคลังต้นทางเพื่อโอน/เบิก).
//   ถ้าไม่ส่ง warehouseId → รวมเฉพาะ "คลังที่ user มีสิทธิ์เห็น" (getAllowedWarehouses) — ไม่ query ข้ามสิทธิ์.
//   ถ้าส่ง → assert สิทธิ์คลังนั้นเหมือนเดิม. อ่านอย่างเดียว (ไม่มี write/ตัดสต๊อก).

/** office: ใบ PO ที่รับเข้าแล้ว — เจาะจงคลัง หรือ "รวมทุกคลังที่มีสิทธิ์" (wh ว่าง). */
export async function listOfficePosForBrowse(warehouseId?: string): Promise<ListPosForMoveResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;
  const wh = (warehouseId ?? "").trim();

  try {
    if (wh) {
      await assertWarehouseAllowed(session, wh);
      const pos = await listReceivablePosForMove(orgId, { warehouseId: wh });
      return { ok: true, pos };
    }
    const ids = (await getAllowedWarehouses(session)).map((w) => w.id);
    if (ids.length === 0) return { ok: true, pos: [] };
    const pos = await listReceivablePosForMove(orgId, { warehouseIds: ids });
    return { ok: true, pos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการใบ PO ไม่สำเร็จ" };
  }
}

/** office: รายละเอียดใบ PO — onHand เจาะจงคลัง หรือ "รวมทุกคลังที่มีสิทธิ์" (wh ว่าง). */
export async function getOfficePoFulfillment(
  poId: string,
  warehouseId?: string,
): Promise<GetPoFulfillmentResult> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์ทำงานหน้าคลัง" };
  const orgId = session.user.org_id;

  const id = (poId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบ PO" };
  const wh = (warehouseId ?? "").trim();

  try {
    if (wh) {
      await assertWarehouseAllowed(session, wh);
      const data = await getPoFulfillment(orgId, id, { warehouseId: wh });
      if (!data) return { ok: false, error: "ไม่พบใบ PO" };
      return { ok: true, data };
    }
    const ids = (await getAllowedWarehouses(session)).map((w) => w.id);
    const data = await getPoFulfillment(orgId, id, { warehouseIds: ids });
    if (!data) return { ok: false, error: "ไม่พบใบ PO" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดใบ PO ไม่สำเร็จ" };
  }
}
