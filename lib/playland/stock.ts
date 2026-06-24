"use server";

// Playland · Stock + Barcode — รับของเข้า (purchase) · เบิกอะไหล่ซ่อม (repair) · ยิงบาร์โค้ด POS
// ทุกการเข้า-ออกของสต๊อกบันทึกใน playland_stock_movements (ledger ตรวจย้อนได้)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newPurchaseCode, newRepairCode } from "./codes";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

// ── ยิงบาร์โค้ดที่ POS → หาสินค้า (USB scanner = พิมพ์โค้ด + Enter · กล้อง = ส่ง string เดียวกัน) ──
export interface BarcodeHit {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
  imageR2Path: string | null;
}
export async function lookupProductByBarcode(input: { branchId: string; barcode: string }): Promise<ActionResult<BarcodeHit>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  const code = input.barcode.trim();
  if (!code) return err("ไม่มีบาร์โค้ด");
  const p = await prisma.playlandProduct.findFirst({
    where: { orgId: session.user.org_id, branchId: input.branchId, barcode: code, active: true, kind: "SALE_ITEM" },
    select: { id: true, name: true, priceCents: true, stock: true, imageR2Path: true },
  });
  if (!p) return err(`ไม่พบสินค้าบาร์โค้ด ${code}`);
  return { ok: true, data: p };
}

// ── รับของเข้า (goods receipt) → สต๊อกเพิ่ม + ต้นทุนเฉลี่ยถ่วงน้ำหนัก + ledger PURCHASE_IN ──
export async function receivePurchase(input: {
  branchId: string;
  supplierName?: string;
  note?: string;
  lines: Array<{ productId: string; quantity: number; unitCostCents: number }>;
}): Promise<ActionResult<{ purchaseId: string; itemsReceived: number; totalCostCents: number }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์รับของเข้า · ต้องเป็นผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  const lines = input.lines.filter((l) => l.quantity > 0 && l.unitCostCents >= 0);
  if (lines.length === 0) return err("ยังไม่ได้ใส่รายการรับเข้า");

  const result = await prisma.$transaction(async (tx) => {
    const ids = lines.map((l) => l.productId);
    const products = await tx.playlandProduct.findMany({ where: { id: { in: ids }, orgId: session.user.org_id, branchId: input.branchId } });
    const pmap = new Map(products.map((p) => [p.id, p]));
    let total = 0;
    const work: Array<{ id: string; name: string; stock: number; cost: number; qty: number; unit: number }> = [];
    for (const l of lines) {
      const p = pmap.get(l.productId);
      if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
      total += l.unitCostCents * l.quantity;
      work.push({ id: p.id, name: p.name, stock: p.stock, cost: p.costCents ?? 0, qty: l.quantity, unit: l.unitCostCents });
    }
    const purchase = await tx.playlandPurchase.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        purchaseCode: newPurchaseCode(),
        supplierName: input.supplierName?.trim() || null,
        note: input.note?.trim() || null,
        totalCostCents: total,
        createdByUserId: session.user.id,
        lines: { create: work.map((w) => ({ orgId: session.user.org_id, productId: w.id, productName: w.name, quantity: w.qty, unitCostCents: w.unit })) },
      },
    });
    for (const w of work) {
      const newStock = w.stock + w.qty;
      // ต้นทุนเฉลี่ยถ่วงน้ำหนัก = (ของเก่า×ต้นทุนเก่า + ของใหม่×ต้นทุนใหม่) / รวม
      const avgCost = newStock > 0 ? Math.round((w.cost * w.stock + w.unit * w.qty) / newStock) : w.unit;
      await tx.playlandProduct.update({ where: { id: w.id }, data: { stock: newStock, costCents: avgCost } });
      await tx.playlandStockMovement.create({
        data: { orgId: session.user.org_id, branchId: input.branchId, productId: w.id, kind: "PURCHASE_IN", quantity: w.qty, unitCostCents: w.unit, balanceAfter: newStock, refType: "purchase", refId: purchase.id, actorUserId: session.user.id },
      });
    }
    return { purchaseId: purchase.id, itemsReceived: work.length, totalCostCents: total };
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath("/playland/stock");
  revalidatePath("/playland/stock/receive");
  revalidatePath("/playland/settings/products");
  return { ok: true, data: result };
}

// ── เพิ่มสินค้าตัวอย่าง (ขนม/น้ำ + อะไหล่) ให้เห็นภาพ · idempotent (ข้ามตัวที่บาร์โค้ดซ้ำ) ──
const SAMPLE_PRODUCTS: Array<{ kind: "SALE_ITEM" | "SPARE_PART"; name: string; category: string; barcode: string; priceBaht: number; costBaht: number; stock: number; reorder: number; supplier?: string }> = [
  // 🍬 ขนม / เครื่องดื่ม (ขายหน้าร้าน)
  { kind: "SALE_ITEM", name: "เลย์ คลาสสิก 50g", category: "ขนม", barcode: "8850718801053", priceBaht: 20, costBaht: 14, stock: 40, reorder: 12, supplier: "แม็คโคร" },
  { kind: "SALE_ITEM", name: "ปริงเกิลส์ ออริจินอล", category: "ขนม", barcode: "8855119000128", priceBaht: 45, costBaht: 32, stock: 24, reorder: 8, supplier: "แม็คโคร" },
  { kind: "SALE_ITEM", name: "ป๊อกกี้ ช็อกโกแลต", category: "ขนม", barcode: "8851019000016", priceBaht: 20, costBaht: 13, stock: 30, reorder: 10, supplier: "แม็คโคร" },
  { kind: "SALE_ITEM", name: "น้ำดื่ม สิงห์ 600ml", category: "เครื่องดื่ม", barcode: "8850999320014", priceBaht: 10, costBaht: 5, stock: 80, reorder: 24, supplier: "สิงห์" },
  { kind: "SALE_ITEM", name: "นมกล่อง โฟร์โมสต์ จืด", category: "เครื่องดื่ม", barcode: "8850157011014", priceBaht: 15, costBaht: 10, stock: 36, reorder: 12, supplier: "โฟร์โมสต์" },
  { kind: "SALE_ITEM", name: "เอส โคล่า 325ml", category: "เครื่องดื่ม", barcode: "8851959132012", priceBaht: 15, costBaht: 9, stock: 48, reorder: 12, supplier: "เสริมสุข" },
  { kind: "SALE_ITEM", name: "ไอติม วอลล์ พาดเดิ้ลป๊อป", category: "ไอศกรีม", barcode: "8851123000035", priceBaht: 15, costBaht: 9, stock: 25, reorder: 10, supplier: "วอลล์" },
  { kind: "SALE_ITEM", name: "หมากฝรั่ง ล็อตเต้", category: "ขนม", barcode: "8851019100013", priceBaht: 10, costBaht: 6, stock: 50, reorder: 15, supplier: "แม็คโคร" },
  // 🔧 อะไหล่ซ่อม (เครื่องเล่น/ในร้าน)
  { kind: "SPARE_PART", name: "มอเตอร์เกียร์ DC 12V", category: "อะไหล่เครื่องเล่น", barcode: "PART-MTR-12V", priceBaht: 0, costBaht: 350, stock: 6, reorder: 2, supplier: "ร้านอะไหล่บางนา" },
  { kind: "SPARE_PART", name: "สายพานยาง A-32", category: "อะไหล่เครื่องเล่น", barcode: "PART-BLT-A32", priceBaht: 0, costBaht: 80, stock: 10, reorder: 4, supplier: "ร้านอะไหล่บางนา" },
  { kind: "SPARE_PART", name: "หลอด LED 5W ขั้ว E27", category: "ไฟ/แสง", barcode: "PART-LED-5W", priceBaht: 0, costBaht: 45, stock: 20, reorder: 8, supplier: "โฮมโปร" },
  { kind: "SPARE_PART", name: "สายรัดข้อมือ RFID", category: "อุปกรณ์หน้าร้าน", barcode: "PART-WB-RFID", priceBaht: 0, costBaht: 18, stock: 200, reorder: 50, supplier: "ผู้จำหน่ายระบบ" },
];

export async function seedSampleProducts(input: { branchId: string }): Promise<ActionResult<{ created: number; skipped: number }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์ · ต้องเป็นผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  // กันซ้ำ: ตัดตัวที่บาร์โค้ดมีอยู่แล้วในสาขานี้ออก (กดปุ่มซ้ำได้ ไม่เพิ่มซ้ำ)
  const codes = SAMPLE_PRODUCTS.map((s) => s.barcode);
  const existing = await prisma.playlandProduct.findMany({
    where: { branchId: input.branchId, barcode: { in: codes } },
    select: { barcode: true },
  });
  const have = new Set(existing.map((e) => e.barcode));
  const toCreate = SAMPLE_PRODUCTS.filter((s) => !have.has(s.barcode));
  if (toCreate.length === 0) return { ok: true, data: { created: 0, skipped: SAMPLE_PRODUCTS.length } };

  let sort = 100;
  await prisma.$transaction(async (tx) => {
    for (const s of toCreate) {
      const p = await tx.playlandProduct.create({
        data: {
          orgId: session.user.org_id,
          branchId: input.branchId,
          kind: s.kind,
          name: s.name,
          category: s.category,
          barcode: s.barcode,
          supplier: s.supplier ?? null,
          priceCents: s.priceBaht * 100,
          costCents: s.costBaht * 100,
          stock: s.stock,
          reorderLevel: s.reorder,
          active: true,
          sortOrder: sort++,
        },
      });
      // ledger: ตั้งต้นสต๊อกตัวอย่าง (เห็นในความเคลื่อนไหวว่ามาจากตัวอย่าง)
      if (s.stock > 0) {
        await tx.playlandStockMovement.create({
          data: { orgId: session.user.org_id, branchId: input.branchId, productId: p.id, kind: "MANUAL_ADJUST", quantity: s.stock, unitCostCents: s.costBaht * 100, balanceAfter: s.stock, refType: "seed", note: "สินค้าตัวอย่าง", actorUserId: session.user.id },
        });
      }
    }
  });

  revalidatePath("/playland/stock");
  revalidatePath("/playland/settings/products");
  return { ok: true, data: { created: toCreate.length, skipped: SAMPLE_PRODUCTS.length - toCreate.length } };
}

// ── บันทึกซ่อมเครื่อง + เบิกอะไหล่ → สต๊อกอะไหล่ลด (race-safe) + ledger PART_USED ──
export async function logRepair(input: {
  branchId: string;
  machineLabel: string;
  description?: string;
  parts: Array<{ productId: string; quantity: number }>;
}): Promise<ActionResult<{ repairId: string; partsCostCents: number }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("ไม่มีสิทธิ์บันทึกซ่อม · ต้องเป็นผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (!input.machineLabel.trim()) return err("ใส่ชื่อเครื่อง/จุดที่ซ่อม");
  const parts = input.parts.filter((p) => p.quantity > 0);

  const result = await prisma.$transaction(async (tx) => {
    const ids = parts.map((p) => p.productId);
    const products = ids.length ? await tx.playlandProduct.findMany({ where: { id: { in: ids }, orgId: session.user.org_id, branchId: input.branchId, kind: "SPARE_PART" } }) : [];
    const pmap = new Map(products.map((p) => [p.id, p]));
    let total = 0;
    const work: Array<{ id: string; name: string; stock: number; cost: number; qty: number }> = [];
    for (const pl of parts) {
      const p = pmap.get(pl.productId);
      if (!p) throw new Error(`ไม่พบอะไหล่ ${pl.productId}`);
      if (p.stock < pl.quantity) throw new Error(`อะไหล่ "${p.name}" เหลือ ${p.stock} ไม่พอเบิก ${pl.quantity}`);
      const cost = p.costCents ?? 0;
      total += cost * pl.quantity;
      work.push({ id: p.id, name: p.name, stock: p.stock, cost, qty: pl.quantity });
    }
    const repair = await tx.playlandRepairLog.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        repairCode: newRepairCode(),
        machineLabel: input.machineLabel.trim(),
        description: input.description?.trim() || null,
        partsCostCents: total,
        createdByUserId: session.user.id,
        parts: { create: work.map((w) => ({ orgId: session.user.org_id, productId: w.id, productName: w.name, quantity: w.qty, unitCostCents: w.cost })) },
      },
    });
    for (const w of work) {
      const upd = await tx.playlandProduct.updateMany({ where: { id: w.id, stock: { gte: w.qty } }, data: { stock: { decrement: w.qty } } });
      if (upd.count === 0) throw new Error(`อะไหล่ ${w.name} เหลือไม่พอ (race)`);
      await tx.playlandStockMovement.create({
        data: { orgId: session.user.org_id, branchId: input.branchId, productId: w.id, kind: "PART_USED", quantity: -w.qty, unitCostCents: w.cost, balanceAfter: w.stock - w.qty, refType: "repair", refId: repair.id, actorUserId: session.user.id },
      });
    }
    return { repairId: repair.id, partsCostCents: total };
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath("/playland/repairs");
  revalidatePath("/playland/stock");
  return { ok: true, data: result };
}
