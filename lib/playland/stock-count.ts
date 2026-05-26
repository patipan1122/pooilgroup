"use server";

// Playland · Stock count · variance form for cycle counts /bigfeature W7
// Cashier/manager counts physical stock · saves difference + reason · audit logged

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchOrg } from "./guards";
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
}): Promise<ActionResult<{ adjusted: number; skipped: number }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (input.lines.length === 0) return err("ไม่มีรายการนับ");

  const productIds = input.lines.map((l) => l.productId);
  const products = await prisma.playlandProduct.findMany({
    where: { id: { in: productIds }, orgId: session.user.org_id, branchId: input.branchId },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  let adjusted = 0;
  let skipped = 0;
  const diffs: Array<{ productId: string; name: string; before: number; after: number; diff: number; reason: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const line of input.lines) {
      const p = pmap.get(line.productId);
      if (!p) { skipped++; continue; }
      if (line.countedQty === p.stock) { skipped++; continue; }
      const diff = line.countedQty - p.stock;
      diffs.push({ productId: p.id, name: p.name, before: p.stock, after: line.countedQty, diff, reason: line.reason ?? "" });
      await tx.playlandProduct.update({
        where: { id: p.id },
        data: { stock: line.countedQty },
      });
      adjusted++;
    }
  });

  if (adjusted > 0) {
    await prisma.playlandAuditLog.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        actorUserId: session.user.id,
        actorRole: session.user.role,
        action: "stock.count",
        entityType: "PlaylandProduct",
        entityId: input.branchId,
        category: "general",
        after: { adjusted, skipped, notes: input.notes, diffs },
      },
    });
  }

  revalidatePath("/playland/settings/stock-count");
  revalidatePath("/playland/settings/products");
  revalidatePath("/playland/pos");
  return { ok: true, data: { adjusted, skipped } };
}
