// DC Warehouse · RECONCILE — non-blocking maintenance pass.
//
// This is a *housekeeping* sweep, not a money-moving operation. It NEVER throws
// to the caller and NEVER blocks the page: each stage is wrapped so a failure
// (or a not-yet-built dependency) degrades gracefully into a note.
//
// What it does, in order:
//   (a) auto-promote stale in-transit transfers (delegated to the transfer agent's
//       autoPromoteStaleTransfers — guarded: if that module isn't present yet we
//       skip it and say so).
//   (b) surface CYCLE-COUNT tasks — products that hold stock but whose last
//       COUNT_ADJUST is older than 30 days (or were never counted). These are
//       SUGGESTIONS only; nothing is written.
//   (c) DC↔TRCloud variance — ONLY attempted if env DC_TRCLOUD_COMPANY_ID is set.
//       DC is truth for physical qty; TRCloud is truth for book value. The gap is
//       the real signal. If TRCloud isn't configured we return trcloudConfigured:false
//       and do nothing (the variance check is a future wire-up, kept honest here).

import { prisma } from "@/lib/prisma";
import { DcMoveKind } from "@/lib/generated/prisma/enums";

const COUNT_STALE_DAYS = 30;

export type CountTask = {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  lastCountedAt: Date | null; // null = never counted
};

export type DcReconcileResult = {
  ok: boolean;
  promotedTransfers: number;
  countTasks: CountTask[];
  trcloudConfigured: boolean;
  note: string;
};

// (a) Guarded delegation to the transfer agent. The module may not exist yet
// (built by a sibling agent) — import dynamically and swallow a missing module.
async function tryAutoPromoteStaleTransfers(orgId: string): Promise<{ promoted: number; note: string }> {
  try {
    // Dynamic so a missing module is a runtime no-op, not a build/import error.
    const mod = (await import("@/lib/dc/transfer-actions").catch(() => null)) as
      | { autoPromoteStaleTransfers?: (orgId: string, olderThanHours?: number) => Promise<unknown> }
      | null;
    if (!mod || typeof mod.autoPromoteStaleTransfers !== "function") {
      return { promoted: 0, note: "ยังไม่มีระบบเลื่อนสถานะการโอนอัตโนมัติ (ข้าม)" };
    }
    const res = await mod.autoPromoteStaleTransfers(orgId);
    // Be liberal about the return shape — accept a number, {promoted}, or {count}.
    let promoted = 0;
    if (typeof res === "number") promoted = res;
    else if (res && typeof res === "object") {
      const r = res as { promoted?: number; count?: number };
      promoted = r.promoted ?? r.count ?? 0;
    }
    return { promoted, note: "" };
  } catch (e) {
    return { promoted: 0, note: `เลื่อนสถานะการโอนอัตโนมัติล้มเหลว: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}` };
  }
}

// (b) Cycle-count task suggestions: products WITH stock whose last COUNT_ADJUST is
// older than 30 days or never counted.
async function buildCountTasks(orgId: string): Promise<CountTask[]> {
  // Products that currently hold stock anywhere in the org.
  const balances = await prisma.dcStockBalance.findMany({
    where: { orgId, qtyOnHand: { gt: 0 } },
    select: {
      productId: true,
      qtyOnHand: true,
      product: { select: { name: true, sku: true, active: true } },
    },
  });
  // Aggregate onHand per product (a SKU can sit in several warehouses).
  const byProduct = new Map<string, { name: string; sku: string; onHand: number }>();
  for (const b of balances) {
    if (!b.product.active) continue;
    const prev = byProduct.get(b.productId);
    if (prev) prev.onHand += b.qtyOnHand;
    else byProduct.set(b.productId, { name: b.product.name, sku: b.product.sku, onHand: b.qtyOnHand });
  }
  const productIds = [...byProduct.keys()];
  if (productIds.length === 0) return [];

  // Last COUNT_ADJUST movement per product (newest-first; keep first seen).
  const counts = await prisma.dcStockMovement.findMany({
    where: { orgId, productId: { in: productIds }, kind: DcMoveKind.COUNT_ADJUST },
    orderBy: { occurredAt: "desc" },
    select: { productId: true, occurredAt: true },
  });
  const lastCount = new Map<string, Date>();
  for (const c of counts) if (!lastCount.has(c.productId)) lastCount.set(c.productId, c.occurredAt);

  const cutoff = new Date(Date.now() - COUNT_STALE_DAYS * 24 * 60 * 60 * 1000);
  const tasks: CountTask[] = [];
  for (const [pid, p] of byProduct) {
    const last = lastCount.get(pid) ?? null;
    if (last === null || last < cutoff) {
      tasks.push({ productId: pid, name: p.name, sku: p.sku, onHand: p.onHand, lastCountedAt: last });
    }
  }
  // Never-counted first, then oldest count first.
  tasks.sort((a, b) => {
    if (a.lastCountedAt === null && b.lastCountedAt === null) return 0;
    if (a.lastCountedAt === null) return -1;
    if (b.lastCountedAt === null) return 1;
    return a.lastCountedAt.getTime() - b.lastCountedAt.getTime();
  });
  return tasks;
}

/**
 * Run the full reconcile pass for one org. NON-blocking: always resolves with a
 * result object; never throws to the caller (each stage degrades to a note).
 */
export async function runDcReconcile(orgId: string): Promise<DcReconcileResult> {
  const notes: string[] = [];

  // (a) stale-transfer auto-promotion.
  const promote = await tryAutoPromoteStaleTransfers(orgId);
  if (promote.note) notes.push(promote.note);

  // (b) cycle-count suggestions.
  let countTasks: CountTask[] = [];
  try {
    countTasks = await buildCountTasks(orgId);
  } catch (e) {
    notes.push(`สร้างรายการนับสต๊อกที่ค้างไม่สำเร็จ: ${e instanceof Error ? e.message : "ไม่ทราบสาเหตุ"}`);
  }

  // (c) DC↔TRCloud variance — only if configured.
  const trcloudConfigured = !!process.env.DC_TRCLOUD_COMPANY_ID;
  if (!trcloudConfigured) {
    notes.push("ยังไม่ได้ตั้งค่า TRCloud (env DC_TRCLOUD_COMPANY_ID) — ข้ามการเทียบมูลค่ากับบัญชี");
  } else {
    notes.push("ตั้งค่า TRCloud แล้ว — การเทียบมูลค่า DC↔TRCloud จะทำในรอบถัดไป");
  }

  if (countTasks.length > 0) {
    notes.unshift(`พบ ${countTasks.length} รายการที่ควรนับสต๊อก (ไม่ได้นับเกิน ${COUNT_STALE_DAYS} วัน หรือยังไม่เคยนับ)`);
  } else {
    notes.unshift("สต๊อกทุกตัวถูกนับภายใน 30 วันที่ผ่านมา — ไม่มีรายการค้างนับ");
  }

  return {
    ok: true,
    promotedTransfers: promote.promoted,
    countTasks,
    trcloudConfigured,
    note: notes.join(" · "),
  };
}
