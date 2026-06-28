"use server";

// DC Warehouse · FLOOR "นับสต๊อก" (stock count) — server actions.
//
// หน้านี้คือหน้าเดียวที่ต้องทำงานได้แม้เน็ตหลุด (back-of-house) → ฝั่ง client
// บัฟเฟอร์รายการนับไว้ใน localStorage แล้วค่อย "ซิงค์" เข้ามาทีหลัง. ฝั่ง server
// idempotent ผ่าน sourceKey("count", lineKey) → ยิงซ้ำ = no-op (กันนับเบิลตอน retry).
//
// แนวคิด: เรา "นับได้เท่าไร" (countedQty) แล้วระบบคิด delta = นับ − ของในระบบ
// ตอน "ซิงค์" จริง (ไม่ trust delta จาก client เพราะ on-hand อาจเปลี่ยนระหว่างหลุดเน็ต)
// → ทุก line จึงเก็บแค่ productId + countedQty + lineKey. ไม่มีเรื่องต้นทุน/เงินในไฟล์นี้.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed } from "@/lib/dc/access";
import { findProductByCode, getOnHand, recordMovement } from "@/lib/dc/stock";
import { sourceKey } from "@/lib/dc/codes";
import { DcMoveKind } from "@/lib/generated/prisma/enums";

export type LookupForCountResult =
  | {
      ok: true;
      product: { id: string; name: string; sku: string; unit: string | null; systemQty: number };
    }
  | { ok: false; error: string };

/**
 * หาสินค้าจากบาร์โค้ด/รหัส + ดึงยอดในระบบ (systemQty) เพื่อตั้งค่าเริ่มต้นช่องนับ.
 * ใช้ตอน online เท่านั้น — offline จะไป resolve ตอนซิงค์.
 */
export async function lookupForCount(input: {
  warehouseId: string;
  code: string;
}): Promise<LookupForCountResult> {
  try {
    const session = await requireSession();
    const orgId = session.user.org_id;
    await assertWarehouseAllowed(session, input.warehouseId);

    const product = await findProductByCode(orgId, input.code);
    if (!product) {
      return { ok: false, error: `ไม่พบสินค้ารหัส "${input.code.trim()}"` };
    }
    const systemQty = await getOnHand(input.warehouseId, product.id);
    return {
      ok: true,
      product: { id: product.id, name: product.name, sku: product.sku, unit: product.unit, systemQty },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ค้นหาสินค้าไม่สำเร็จ" };
  }
}

/**
 * รายชื่อ "หมวดหมู่" (category) ที่ไม่ว่าง ของสินค้า active ในองค์กร (distinct).
 * category เป็น free-text → group + เรียงตามตัวอักษร. ใช้ทำ filter ในหน้านับ (online เท่านั้น).
 */
export async function listCategoriesForCount(): Promise<string[]> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) return [];
    const orgId = session.user.org_id;

    const rows = await prisma.dcProduct.findMany({
      where: { orgId, active: true, category: { not: null } },
      distinct: ["category"],
      orderBy: { category: "asc" },
      select: { category: true },
    });
    return rows
      .map((r) => (r.category ?? "").trim())
      .filter((c) => c.length > 0);
  } catch {
    return [];
  }
}

export type CountProductRow = {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  systemQty: number;
};

export type ListProductsForCountResult =
  | { ok: true; products: CountProductRow[] }
  | { ok: false; error: string };

/**
 * รายการสินค้า active ในองค์กร (กรอง category + ค้นหา q ได้) พร้อมยอดในระบบ (systemQty)
 * ของคลังที่กำลังนับ. ใช้สำหรับหน้า "ดูสินค้าทั้งหมด" → กดเลือกสินค้าที่จะนับเอง (online เท่านั้น).
 *  • systemQty = qtyOnHand ใน dcStockBalance ของคลังนั้น (0 ถ้าไม่มีแถว balance)
 *  • limit ~200 (กันโหลดยาวบนมือถือ)
 */
export async function listProductsForCount(input: {
  warehouseId: string;
  category?: string;
  q?: string;
}): Promise<ListProductsForCountResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์นับสต๊อก" };
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
      take: 200,
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        unit: true,
        // ดึงเฉพาะ balance ของคลังที่นับ → systemQty
        balances: {
          where: { warehouseId: input.warehouseId },
          select: { qtyOnHand: true },
          take: 1,
        },
      },
    });

    return {
      ok: true,
      products: products.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit: p.unit,
        systemQty: p.balances[0]?.qtyOnHand ?? 0,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "โหลดรายการสินค้าไม่สำเร็จ" };
  }
}

export type SyncCountLine = { productId: string; countedQty: number; lineKey: string };

export type SyncCountsResult =
  | {
      ok: true;
      synced: string[];
      results: { productId: string; delta: number; balanceAfter: number }[];
    }
  | { ok: false; error: string };

/**
 * ซิงค์รายการนับที่บัฟเฟอร์ไว้เข้าระบบ.
 *  • delta คิดสด ณ ตอนซิงค์ (countedQty − on-hand ปัจจุบัน) ไม่เชื่อ client
 *  • delta !== 0 → recordMovement(COUNT_ADJUST) ด้วย sourceKey("count", lineKey)
 *    → ยิงซ้ำ = no-op (idempotent ที่ DB) → re-sync ปลอดภัย
 *  • delta === 0 → ไม่ต้องบันทึก movement แต่ถือว่า "ซิงค์แล้ว" (คืน lineKey)
 *    เพื่อให้ client ลบออกจาก buffer ได้
 */
export async function syncCounts(input: {
  warehouseId: string;
  lines: SyncCountLine[];
}): Promise<SyncCountsResult> {
  try {
    const session = await requireSession();
    if (!canDcFloor(session.user.role)) {
      return { ok: false, error: "ไม่มีสิทธิ์นับสต๊อก" };
    }
    await assertWarehouseAllowed(session, input.warehouseId);
    const orgId = session.user.org_id;
    const userId = session.user.id;

    const synced: string[] = [];
    const results: { productId: string; delta: number; balanceAfter: number }[] = [];

    for (const line of input.lines) {
      const lineKey = String(line.lineKey || "").trim();
      const productId = String(line.productId || "").trim();
      const counted = Number(line.countedQty);
      // ข้ามรายการที่ข้อมูลไม่ครบ (offline ที่ยังหาสินค้าไม่เจอ) — ไม่ mark synced
      if (!lineKey || !productId || !Number.isFinite(counted)) continue;

      const current = await getOnHand(input.warehouseId, productId);
      const delta = counted - current;

      if (delta === 0) {
        // ไม่มีส่วนต่าง → ไม่บันทึก movement แต่ถือว่าซิงค์เรียบร้อย
        synced.push(lineKey);
        results.push({ productId, delta: 0, balanceAfter: current });
        continue;
      }

      const res = await recordMovement({
        orgId,
        warehouseId: input.warehouseId,
        productId,
        kind: DcMoveKind.COUNT_ADJUST,
        qty: delta,
        sourceKey: sourceKey("count", lineKey),
        refType: "floor_count",
        actorUserId: userId,
        note: `นับได้ ${counted}`,
      });
      if (!res.ok) {
        // ปล่อย line นี้ค้างใน buffer (ไม่ push synced) → ผู้ใช้ลองซิงค์ใหม่ได้
        return { ok: false, error: res.error };
      }
      synced.push(lineKey);
      results.push({ productId, delta, balanceAfter: res.balanceAfter });
    }

    return { ok: true, synced, results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ซิงค์ไม่สำเร็จ" };
  }
}
