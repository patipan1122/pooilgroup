"use server";

// DC Warehouse · FLOOR "ค้นหา" (search / where-is-it) — server actions.
//
// ทุก action: requireSession + canDcFloor(role) (ไม่ผ่าน = throw) · scope orgId เสมอ.
//   • searchProducts — ค้นชื่อ/SKU/บาร์โค้ด (insensitive) คืน ≤30 รายการ
//   • resolveCode    — สแกน/พิมพ์รหัส → findProductByCode → productId (กดต่อ productDetail)
//   • productDetail  — รายละเอียดสินค้า + "ของอยู่ที่ไหน" (ทุกคลังที่ผู้ใช้เข้าถึงได้)
//                      + การเคลื่อนไหวล่าสุด 8 รายการ
//
// labels-workspace import searchProducts + resolveCode จากไฟล์นี้ซ้ำได้.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcFloor } from "@/lib/dc/role-guard";
import { getAllowedWarehouses } from "@/lib/dc/access";
import { findProductByCode } from "@/lib/dc/stock";
import { MOVE_KIND_LABEL } from "@/lib/dc/nav";

/** Guard: ต้อง login + มีสิทธิ์ทำงานหน้าคลัง. */
async function requireFloor() {
  const session = await requireSession();
  if (!canDcFloor(session.user.role)) {
    throw new Error("ไม่มีสิทธิ์ทำงานหน้าคลัง");
  }
  return session;
}

// ---- ค้นหาสินค้า (text search) ----

export type SearchProductRow = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  type: string;
  unit: string;
};

/** ค้นชื่อ/SKU/บาร์โค้ด (insensitive) ภายใน org · active เท่านั้น · ≤30 แถว. */
export async function searchProducts({ q }: { q: string }): Promise<SearchProductRow[]> {
  const session = await requireFloor();
  const orgId = session.user.org_id;

  const term = (q ?? "").trim();
  if (!term) return [];

  const rows = await prisma.dcProduct.findMany({
    where: {
      orgId,
      active: true,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { barcode: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 30,
    select: { id: true, sku: true, name: true, barcode: true, type: true, unit: true },
  });

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    barcode: r.barcode,
    type: r.type,
    unit: r.unit,
  }));
}

// ---- สแกน/พิมพ์รหัส → productId ----

export type ResolveCodeResult =
  | { ok: true; productId: string }
  | { ok: false; error: string };

/** สแกน/พิมพ์รหัส → หาสินค้าจากบาร์โค้ด/SKU → productId (เอาไปเรียก productDetail ต่อ). */
export async function resolveCode({ code }: { code: string }): Promise<ResolveCodeResult> {
  const session = await requireFloor();
  const orgId = session.user.org_id;

  const c = (code ?? "").trim();
  if (!c) return { ok: false, error: "กรุณากรอกรหัส" };

  const product = await findProductByCode(orgId, c);
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  return { ok: true, productId: product.id };
}

// ---- รายละเอียดสินค้า + ของอยู่ที่ไหน ----

export type ProductBalanceRow = {
  warehouseName: string;
  qtyOnHand: number;
  qtyInTransit: number;
  location: string | null;
};

export type ProductMovementRow = {
  kind: string;
  qty: number;
  balanceAfter: number | null;
  occurredAt: string;
  note: string | null;
};

export type ProductDetailResult =
  | {
      ok: true;
      product: { id: string; sku: string; name: string; barcode: string | null; type: string; unit: string };
      balances: ProductBalanceRow[];
      movements: ProductMovementRow[];
    }
  | { ok: false; error: string };

/**
 * รายละเอียดสินค้า 1 ตัว:
 *  - product (ชื่อ/SKU/ประเภท/หน่วย)
 *  - balances: ทุกคลังที่ผู้ใช้เข้าถึงได้ (getAllowedWarehouses) ที่มี balance row →
 *    ตำแหน่ง (location) + คงเหลือ (qtyOnHand) + ระหว่างทาง (qtyInTransit)
 *  - movements: การเคลื่อนไหวล่าสุด 8 รายการ (occurredAt desc) พร้อม label ไทย
 */
export async function productDetail({ productId }: { productId: string }): Promise<ProductDetailResult> {
  const session = await requireFloor();
  const orgId = session.user.org_id;

  const pid = (productId ?? "").trim();
  if (!pid) return { ok: false, error: "ไม่พบสินค้า" };

  const product = await prisma.dcProduct.findFirst({
    where: { id: pid, orgId },
    select: { id: true, sku: true, name: true, barcode: true, type: true, unit: true },
  });
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };

  // คลังที่ผู้ใช้เข้าถึงได้ → map id → name + จำกัด balances ให้อยู่ในคลังเหล่านี้เท่านั้น
  const allowed = await getAllowedWarehouses(session);
  const allowedIds = allowed.map((w) => w.id);
  const nameById = new Map(allowed.map((w) => [w.id, w.name]));

  const balanceRows =
    allowedIds.length === 0
      ? []
      : await prisma.dcStockBalance.findMany({
          where: { orgId, productId: pid, warehouseId: { in: allowedIds } },
          select: { warehouseId: true, qtyOnHand: true, qtyInTransit: true, location: true },
        });

  // เรียงตามลำดับคลัง (allowed) เพื่อให้คลังหลัก/เริ่มต้นขึ้นก่อน
  const order = new Map(allowedIds.map((id, i) => [id, i]));
  const balances: ProductBalanceRow[] = balanceRows
    .slice()
    .sort((a, b) => (order.get(a.warehouseId) ?? 0) - (order.get(b.warehouseId) ?? 0))
    .map((b) => ({
      warehouseName: nameById.get(b.warehouseId) ?? "—",
      qtyOnHand: b.qtyOnHand,
      qtyInTransit: b.qtyInTransit,
      location: b.location,
    }));

  // การเคลื่อนไหวล่าสุด 8 รายการ (เฉพาะคลังที่เข้าถึงได้ — ไม่หลุดข้ามคลังที่ไม่มีสิทธิ์)
  const moveRows =
    allowedIds.length === 0
      ? []
      : await prisma.dcStockMovement.findMany({
          where: { orgId, productId: pid, warehouseId: { in: allowedIds } },
          orderBy: { occurredAt: "desc" },
          take: 8,
          select: { kind: true, qty: true, balanceAfter: true, occurredAt: true, note: true },
        });

  const movements: ProductMovementRow[] = moveRows.map((m) => ({
    kind: MOVE_KIND_LABEL[m.kind] ?? m.kind,
    qty: m.qty,
    balanceAfter: m.balanceAfter,
    occurredAt: m.occurredAt.toISOString(),
    note: m.note,
  }));

  return { ok: true, product, balances, movements };
}
