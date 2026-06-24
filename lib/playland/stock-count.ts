"use server";

// Playland · Stock count · variance form for cycle counts /bigfeature W7
// Cashier/manager counts physical stock · saves difference + reason · audit logged

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newStockCountCode } from "./codes";
import { revalidatePath } from "next/cache";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
function err(msg: string) { return { ok: false as const, error: msg }; }

export interface StockCountLine {
  productId: string;
  countedQty: number;
  reason?: string;
}

export async function submitStockCount(input: {
  branchId: string;
  lines: StockCountLine[];
  notes?: string;
}): Promise<ActionResult<{ adjusted: number; skipped: number; countId: string | null }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.lines.length === 0) return err("ไม่มีรายการนับ");

  const productIds = input.lines.map((l) => l.productId);
  const products = await prisma.playlandProduct.findMany({
    where: { id: { in: productIds }, orgId: session.user.org_id, branchId: input.branchId },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  // คำนวณรายการที่ต่างจากระบบก่อน (เฉพาะที่ปรับจริงถึงเก็บเป็นใบ)
  const diffs: Array<{ productId: string; name: string; before: number; after: number; diff: number; reason: string }> = [];
  let skipped = 0;
  for (const line of input.lines) {
    const p = pmap.get(line.productId);
    if (!p) { skipped++; continue; }
    if (line.countedQty === p.stock) { skipped++; continue; }
    diffs.push({ productId: p.id, name: p.name, before: p.stock, after: line.countedQty, diff: line.countedQty - p.stock, reason: line.reason ?? "" });
  }

  if (diffs.length === 0) {
    // นับครบแต่ตรงระบบทุกตัว → ไม่มีอะไรปรับ · ไม่สร้างใบ
    return { ok: true, data: { adjusted: 0, skipped, countId: null } };
  }

  const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);

  const countId = await prisma.$transaction(async (tx) => {
    // หัวใบนับสต๊อก (ดูย้อนหลังได้ · ใครนับ · เมื่อไหร่ · หมายเหตุ)
    const count = await tx.playlandStockCount.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        countCode: newStockCountCode(),
        note: input.notes?.trim() || null,
        itemsCounted: diffs.length,
        totalDiff,
        countedByUserId: session.user.id,
        countedByName: session.user.name || session.user.email || null,
        lines: {
          create: diffs.map((d) => ({
            orgId: session.user.org_id,
            productId: d.productId,
            productName: d.name,
            systemQty: d.before,
            countedQty: d.after,
            diff: d.diff,
            reason: d.reason || null,
          })),
        },
      },
    });
    for (const d of diffs) {
      await tx.playlandProduct.update({ where: { id: d.productId }, data: { stock: d.after } });
      // ledger: ปรับจากการนับสต๊อก (อ้างใบนับ)
      await tx.playlandStockMovement.create({
        data: { orgId: session.user.org_id, branchId: input.branchId, productId: d.productId, kind: "COUNT_ADJUST", quantity: d.diff, balanceAfter: d.after, refType: "count", refId: count.id, note: d.reason || null, actorUserId: session.user.id },
      });
    }
    return count.id;
  });

  await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "stock.count",
      entityType: "PlaylandStockCount",
      entityId: countId,
      category: "general",
      after: { adjusted: diffs.length, skipped, notes: input.notes, totalDiff, diffs },
    },
  });

  revalidatePath("/playland/stock");
  revalidatePath("/playland/settings/products");
  revalidatePath("/playland/pos");
  return { ok: true, data: { adjusted: diffs.length, skipped, countId } };
}
