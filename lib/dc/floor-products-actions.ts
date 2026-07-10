"use server";

// DC Warehouse · FLOOR "ดูสินค้า / สต๊อก" (browse/catalog) — server action.
//
// หน้าไล่ดูสินค้าทั้งหมด (พร้อมรูป + คงเหลือในคลัง) สำหรับพนักงานหน้างานบนมือถือ —
// ไม่ต้องสแกนก่อน. เป็น READ-ONLY: ไม่มีการเขียน/ขยับสต๊อกในไฟล์นี้เลย.
//
// ต่างจาก listProductsForCount (count-actions.ts) ตรงที่ "ไม่ซ่อนสินค้าคงเหลือ = 0" —
// นี่คือหน้า catalog ให้เห็นทุกตัว (แม้ของหมด) เพื่อให้พนักงานเช็ก/หา/ดูรูปได้ครบ.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { listCategoriesForCount as _listCategoriesForCount } from "@/lib/dc/count-actions";

// reuse ตัวเดิม (distinct category ของสินค้า active) — ห้าม re-export ตรง ๆ ในไฟล์ "use server"
// (export ได้เฉพาะ async function) → ครอบเป็น async wrapper คงชื่อ export เดิมไว้
export async function listCategoriesForCount(): Promise<string[]> {
  return _listCategoriesForCount();
}

export type FloorProductRow = {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  systemQty: number; // คงเหลือ (on-hand) ของคลังนั้น — 0 ถ้าไม่มีแถว balance
  imageUrl: string | null; // resolve เป็น URL เต็มฝั่ง server แล้ว · null = ไม่มีรูป
};

export type ListDcFloorProductsResult =
  | { ok: true; products: FloorProductRow[] }
  | { ok: false; error: string };

/**
 * รายการสินค้า active "ทั้งหมด" ในองค์กร (กรอง category + ค้นหา q ได้) พร้อมคงเหลือของคลังนั้น.
 * ใช้ในหน้า /dc/products (ไล่ดู catalog) — ต่างจากหน้านับ:
 *  • ไม่ซ่อนสินค้าคงเหลือ = 0 (โชว์ทุกตัว รวม "หมด") — เป็นหน้าดู/ค้น ไม่ใช่หน้านับ
 *  • systemQty = qtyOnHand ใน dcStockBalance ของคลังนั้น (0 ถ้าไม่มีแถว balance)
 *  • take ~300 เรียงตามชื่อ (กันโหลดยาวบนมือถือ)
 */
export async function listDcFloorProducts(input: {
  warehouseId: string;
  category?: string;
  q?: string;
}): Promise<ListDcFloorProductsResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์ดูสินค้าคลัง" };
    }
    await assertWarehouseAllowed(session, input.warehouseId);
    const orgId = session.user.org_id;

    const category = (input.category ?? "").trim();
    const q = (input.q ?? "").trim();

    const products = await prisma.dcProduct.findMany({
      where: {
        orgId,
        active: true,
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      take: 300,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        unit: true,
        imageR2Path: true,
        balances: {
          where: { warehouseId: input.warehouseId },
          select: { qtyOnHand: true },
          take: 1,
        },
      },
    });

    // resolve รูปเป็น URL เต็มฝั่ง server (client อ่าน env ไม่ได้)
    const r2Public = process.env.R2_PUBLIC_URL ?? "";
    const toImageUrl = (key: string | null): string | null =>
      !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

    return {
      ok: true,
      // ไม่กรอง qty = 0 — โชว์ทุกตัว (catalog view)
      products: products.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit: p.unit,
        systemQty: p.balances[0]?.qtyOnHand ?? 0,
        imageUrl: toImageUrl(p.imageR2Path),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการสินค้าไม่สำเร็จ" };
  }
}
