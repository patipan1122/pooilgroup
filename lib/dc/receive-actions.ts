"use server";

// DC Warehouse · FLOOR "รับเข้า" (receive) — server actions.
//
// ทุก action: requireSession + canDcFloor(role) (ไม่ผ่าน = throw) · scope ด้วย
// orgId เสมอ · ยืนยันสิทธิ์คลังด้วย assertWarehouseAllowed ก่อนบันทึก.
//
// ★ IDEMPOTENCY: ทุกบรรทัดรับเข้าพก lineKey (uuid จาก client) → sourceKey("recv",
//   lineKey) → @@unique([orgId, sourceKey]) ทำให้กดซ้ำ/รีทรายเป็น no-op (duplicate)
//   ไม่บวกสต๊อกซ้ำ. (กับดักเดิม PlaylandStockMovement ไม่มี key — ห้ามซ้ำรอย.)

import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { sourceKey } from "@/lib/dc/codes";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import {
  recordMovement,
  findProductByCode,
  getOnHand,
} from "@/lib/dc/stock";

/** Guard: ต้อง login + มีสิทธิ์ทำงานหน้าคลัง. คืน {orgId, userId}. */
async function requireFloor(): Promise<{ orgId: string; userId: string }> {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์ทำงานหน้าคลัง");
  }
  return { orgId: session.user.org_id, userId: session.user.id };
}

// ---- รับเข้า (post receive) ----

export type ReceiveLine = {
  productId: string;
  qty: number;
  unitCostSatang?: number | null;
  /** uuid ต่อบรรทัด (client สร้างตอนเพิ่ม) — ใช้ทำ idempotency key */
  lineKey: string;
};

export type PostReceiveInput = {
  warehouseId: string;
  lines: ReceiveLine[];
};

export type PostReceiveResult =
  | { ok: true; posted: number; balances: { productId: string; balanceAfter: number }[] }
  | { ok: false; error: string };

/**
 * บันทึกรับเข้าหลายบรรทัดในครั้งเดียว.
 * - ตรวจสิทธิ์ floor + ยืนยันคลังอยู่ในขอบเขตของผู้ใช้ (org + allowed).
 * - แต่ละบรรทัดผ่าน recordMovement (atomic + idempotent ด้วย sourceKey).
 * - duplicate (กดซ้ำ) นับเป็นสำเร็จแบบ no-op ไม่ทำให้ทั้งใบล้ม.
 */
export async function postReceive(input: PostReceiveInput): Promise<PostReceiveResult> {
  const { orgId, userId } = await requireFloor();

  const warehouseId = (input.warehouseId ?? "").trim();
  if (!warehouseId) return { ok: false, error: "ยังไม่ได้เลือกคลัง" };

  // ยืนยันคลังเป็นของ org + อยู่ในคลังที่ผู้ใช้เข้าถึงได้
  const session = await requireSession();
  try {
    await assertWarehouseAllowed(session, warehouseId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  // กรองบรรทัดที่ใช้ได้ (qty > 0 + มี productId + lineKey)
  const lines = (input.lines ?? []).filter(
    (l) => l.productId && l.lineKey && Number.isFinite(l.qty) && l.qty > 0,
  );
  if (lines.length === 0) return { ok: false, error: "ยังไม่มีรายการรับเข้า" };

  // รวมบรรทัดที่ lineKey ซ้ำกัน (กันยิงซ้ำในใบเดียว) — เก็บอันแรกไว้
  const seen = new Set<string>();
  const uniqueLines = lines.filter((l) => {
    if (seen.has(l.lineKey)) return false;
    seen.add(l.lineKey);
    return true;
  });

  const balances: { productId: string; balanceAfter: number }[] = [];
  let posted = 0;

  for (const line of uniqueLines) {
    const qty = Math.trunc(line.qty);
    if (qty <= 0) continue;
    const res = await recordMovement({
      orgId,
      warehouseId,
      productId: line.productId,
      kind: DcMoveKind.RECEIVE,
      qty, // signed + (รับเข้า)
      unitCostSatang:
        line.unitCostSatang == null || Number.isNaN(line.unitCostSatang)
          ? null
          : Math.max(0, Math.trunc(line.unitCostSatang)),
      sourceKey: sourceKey("recv", line.lineKey),
      refType: "floor_receive",
      actorUserId: userId,
      note: "รับเข้าหน้าคลัง",
    });

    if (!res.ok) {
      // บรรทัดเดียวพัง → คืน error ทันที (บรรทัดก่อนหน้าที่สำเร็จ idempotent อยู่แล้ว
      // กดใหม่จะข้ามตัวเดิม ไม่ซ้ำ)
      return { ok: false, error: res.error };
    }

    // duplicate = no-op ที่สำเร็จ (กดซ้ำ) — ยังถือว่า posted เพื่อ UX ราบรื่น
    posted += 1;
    balances.push({ productId: line.productId, balanceAfter: res.balanceAfter });
  }

  return { ok: true, posted, balances };
}

// ---- ค้นหาสินค้า (สแกน/พิมพ์รหัส) ----

export type LookupProductResult =
  | {
      ok: true;
      product: { id: string; sku: string; name: string; unit: string; onHand: number };
    }
  | { ok: false; error: string };

/**
 * ค้นหาสินค้าจากบาร์โค้ด/SKU + อ่านยอดคงเหลือในคลังที่ระบุ.
 * ใช้ตอนสแกน/พิมพ์รหัสหน้ารับเข้า. scope ด้วย orgId ของผู้ใช้.
 */
export async function lookupProduct(
  code: string,
  warehouseId: string,
): Promise<LookupProductResult> {
  const { orgId } = await requireFloor();

  const c = (code ?? "").trim();
  if (!c) return { ok: false, error: "กรุณากรอกรหัส" };

  const product = await findProductByCode(orgId, c);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  const wh = (warehouseId ?? "").trim();
  const onHand = wh ? await getOnHand(wh, product.id) : 0;

  return {
    ok: true,
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit ?? "ชิ้น",
      onHand,
    },
  };
}
