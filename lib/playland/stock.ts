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
