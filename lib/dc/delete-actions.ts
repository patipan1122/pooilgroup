"use server";

// DC คลังกลาง · ลบเอกสาร (hard-delete + cascade) — CEO 2026-07-10.
//
// 🗑️ เจตนา: ลบใบใดก็ให้ "สิ่งที่เกิดขึ้นจากใบนั้นหายตามจริง" —
//   • ใบหายจากรายการเอกสาร (hard-delete header + lines cascade)
//   • สต๊อก/ต้นทุนกลับเป็นเหมือนไม่เคยเกิด (compensating movement — ปลอดภัยสุด ไม่แตะ balance ตรง ๆ)
//   • ลบ PO → ใบรับ (GRN) ที่เกิดจาก PO นั้นหายตาม (cascade · GRN ไม่มี FK กลับ PO → query poId เอง)
//   • GRN ที่ push TRCloud แล้ว → สั่งลบเอกสารใน TRCloud ให้ด้วย (deleteStockIn · best-effort)
//   • ทุกการลบเก็บ snapshot เต็มลง DcDeletionLog (กู้คืน/ตรวจย้อนได้)
//
// 🔒 สิทธิ์: super_admin (CEO) เท่านั้น — ช่วง trial (ยังไม่เปิด program_admin/admin).
//
// 🏗️ ความปลอดภัย (RULE I):
//   • Idempotent — reversal movement ใช้ sourceKey prefix เฉพาะ ("*-del") → กดซ้ำ = no-op
//   • Money-safe — ถ้าของถูกเบิก/โอนออกไปแล้ว (สต๊อกจะติดลบ) → BLOCK พร้อมข้อความชัด ไม่ปล่อยติดลบ
//   • Reversal ทำก่อน (นอก tx · แต่ละอัน atomic) แล้วค่อยลบ header ใน $transaction → ล้มกลางคัน = re-click ปลอดภัย
//   • ไม่ลบแถว movement เดิม (balanceAfter ของแถวหลังจะเพี้ยน) → append รายการกลับแทน (แบบ cancelTransfer)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { sourceKey } from "@/lib/dc/codes";
import { recordMovement, getOnHand } from "@/lib/dc/stock";
import { DcMoveKind, DcPostStatus, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { deleteStockIn } from "@/lib/ledger/trcloud-inventory";

export type DeleteDocResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

type Deleter = { orgId: string; userId: string; userName: string };

/** Guard: login + super_admin (CEO) เท่านั้น. */
async function requireDeleter(): Promise<
  { ok: true; deleter: Deleter } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, error: "ลบเอกสารได้เฉพาะผู้ดูแลสูงสุด (CEO/super_admin) เท่านั้น" };
  }
  return {
    ok: true,
    deleter: {
      orgId: session.user.org_id,
      userId: session.user.id,
      userName: session.user.name,
    },
  };
}

/** แปลง object เป็น JSON ล้วน (Decimal/Date → string) เพื่อเก็บใน Json column. */
function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

/** เขียนบันทึกการลบ (snapshot) — ใช้ภายใน $transaction. */
function deletionLogData(args: {
  orgId: string;
  docType: string;
  docId: string;
  docCode: string;
  snapshot: unknown;
  reversal?: unknown;
  cascadedFromType?: string | null;
  cascadedFromId?: string | null;
  note?: string | null;
  deletedByUserId: string;
  deletedByName: string | null;
}) {
  return {
    orgId: args.orgId,
    docType: args.docType,
    docId: args.docId,
    docCode: args.docCode,
    snapshot: toJson(args.snapshot),
    reversal: args.reversal == null ? undefined : toJson(args.reversal),
    cascadedFromType: args.cascadedFromType ?? null,
    cascadedFromId: args.cascadedFromId ?? null,
    note: args.note ?? null,
    deletedByUserId: args.deletedByUserId,
    deletedByName: args.deletedByName,
  };
}

function revalidateDc() {
  for (const p of [
    "/dc/office/purchasing",
    "/dc/office/receipts",
    "/dc/office/transfers",
    "/dc/office/issue",
    "/dc/move",
    "/dc/office/deletions",
    "/dc/office/products",
  ]) {
    revalidatePath(p);
  }
}

// ════════════════════════════════════════════════════════════════════
// GRN (ใบรับสินค้า) — ตัวอันตรายสุด (สต๊อก + TRCloud)
// ════════════════════════════════════════════════════════════════════

type GrnRecord = {
  id: string;
  grnCode: string;
  warehouseId: string;
  poId: string | null;
  shipmentId: string | null;
  status: string;
  postStatus: DcPostStatus;
  note: string | null;
  receivedAt: Date;
  receivedByUserId: string;
};

async function loadGrn(orgId: string, grnId: string): Promise<GrnRecord | null> {
  return prisma.dcGoodsReceipt.findFirst({
    where: { id: grnId, orgId },
    select: {
      id: true, grnCode: true, warehouseId: true, poId: true, shipmentId: true,
      status: true, postStatus: true, note: true, receivedAt: true, receivedByUserId: true,
    },
  });
}

/**
 * ตรวจว่าใบรับ (GRN) เหล่านี้ "ย้อนได้ไหม" — ถ้าของถูกเบิก/โอนออกไปจนสต๊อกจะติดลบ → คืนชื่อสินค้าที่ติด.
 * คืน null = ย้อนได้ทั้งหมด · คืน string = เหตุผลบล็อก.
 */
export async function assertReceiptsReversible(orgId: string, grnIds: string[]): Promise<string | null> {
  if (grnIds.length === 0) return null;
  const movements = await prisma.dcStockMovement.findMany({
    where: { orgId, refType: "grn", refId: { in: grnIds } },
    select: { warehouseId: true, productId: true, qty: true },
  });
  // รวมยอดที่ต้อง "ตัดออก" ต่อ (คลัง×สินค้า)
  const need = new Map<string, { warehouseId: string; productId: string; qty: number }>();
  for (const m of movements) {
    const k = `${m.warehouseId}|${m.productId}`;
    const cur = need.get(k) ?? { warehouseId: m.warehouseId, productId: m.productId, qty: 0 };
    cur.qty += m.qty; // qty รับเข้าเป็นบวก
    need.set(k, cur);
  }
  for (const g of need.values()) {
    if (g.qty <= 0) continue;
    const onHand = await getOnHand(g.warehouseId, g.productId);
    if (onHand < g.qty) {
      const p = await prisma.dcProduct.findUnique({ where: { id: g.productId }, select: { name: true, sku: true } });
      const name = p ? `${p.name} (${p.sku})` : g.productId;
      return `สินค้า "${name}" ถูกเบิก/โอนออกไปแล้ว (คงเหลือ ${onHand} แต่รับเข้าไว้ ${g.qty}) — ลบใบรับไม่ได้ ต้องคืน/ปรับของก่อน`;
    }
  }
  return null;
}

/**
 * ลบใบรับ 1 ใบ (core): คืนสต๊อก + TRCloud + ลบ header/lines/cost-layer + เขียน log.
 * เรียกทั้งจากการลบ GRN ตรง ๆ และจาก cascade ตอนลบ PO.
 * ⚠️ ผู้เรียกต้อง requireDeleter มาแล้ว + (แนะนำ) assertReceiptsReversible ผ่านแล้ว.
 */
async function deleteGrnCore(
  grn: GrnRecord,
  deleter: Deleter,
  cascade?: { fromType: string; fromId: string },
): Promise<DeleteDocResult> {
  const { orgId } = deleter;

  const [lines, costLayers, movements] = await Promise.all([
    prisma.dcGoodsReceiptLine.findMany({ where: { orgId, grnId: grn.id } }),
    prisma.dcCostLayer.findMany({ where: { orgId, grnId: grn.id } }),
    prisma.dcStockMovement.findMany({ where: { orgId, refType: "grn", refId: grn.id } }),
  ]);

  // 1) คืนสต๊อก — ตัดของที่รับเข้าออก (compensating: qty ตรงข้าม). ติดลบ = BLOCK.
  let reversed = 0;
  for (const m of movements) {
    if (m.qty === 0) continue;
    const back = await recordMovement({
      orgId,
      warehouseId: m.warehouseId,
      productId: m.productId,
      kind: DcMoveKind.COUNT_ADJUST,
      qty: -m.qty, // รับเข้าเป็นบวก → ตัดออกเป็นลบ
      unitCostSatang: m.unitCostSatang,
      sourceKey: sourceKey("grn-del", grn.id, m.id),
      refType: "dc_grn_delete",
      refId: grn.id,
      note: `ลบใบรับ ${grn.grnCode} — ตัดของที่รับเข้าออก`,
      actorUserId: deleter.userId,
    });
    if (!back.ok) {
      return { ok: false, error: `ลบใบรับ ${grn.grnCode} ไม่ได้: ${back.error}` };
    }
    if (!back.duplicate) reversed += 1;
  }

  // 2) TRCloud — ถ้า push แล้ว (POSTED) สั่งลบเอกสารในบัญชี (best-effort · ไม่ล้มทั้งใบ)
  let trcloud: { action: string; docId?: string | null; error?: string } = { action: "none" };
  const obSourceKey = sourceKey("grn-trcloud", grn.id);
  const outbox = await prisma.dcOutboxEvent.findUnique({
    where: { orgId_sourceKey_eventType: { orgId, sourceKey: obSourceKey, eventType: "trcloud_stock_in" } },
    select: { id: true, payload: true },
  });
  const docId =
    outbox && typeof outbox.payload === "object" && outbox.payload !== null
      ? ((outbox.payload as Record<string, unknown>).docId as string | undefined)
      : undefined;
  if (grn.postStatus === DcPostStatus.POSTED && docId) {
    const r = await deleteStockIn(docId);
    trcloud = r.ok
      ? { action: "deleted", docId }
      : { action: "failed", docId, error: r.error };
  } else if (docId) {
    trcloud = { action: "skipped", docId };
  }

  const snapshot = { grn, lines, costLayers, movements };
  const reversal = {
    movementsReversed: reversed,
    trcloud,
    ...(trcloud.action === "failed"
      ? { warn: "TRCloud ลบไม่สำเร็จ — โปรดลบเอกสารรับเข้าในบัญชี TRCloud ด้วยมือ" }
      : {}),
  };

  // 3) ลบจริง (atomic): log + cost-layer + outbox + header (lines cascade เอง)
  await prisma.$transaction([
    prisma.dcDeletionLog.create({
      data: deletionLogData({
        orgId, docType: "grn", docId: grn.id, docCode: grn.grnCode,
        snapshot, reversal,
        cascadedFromType: cascade?.fromType ?? null,
        cascadedFromId: cascade?.fromId ?? null,
        deletedByUserId: deleter.userId, deletedByName: deleter.userName,
      }),
    }),
    prisma.dcCostLayer.deleteMany({ where: { orgId, grnId: grn.id } }),
    prisma.dcOutboxEvent.deleteMany({ where: { orgId, sourceKey: obSourceKey } }),
    prisma.dcGoodsReceipt.delete({ where: { id: grn.id } }),
  ]);

  const trNote =
    trcloud.action === "deleted" ? " + ลบเอกสาร TRCloud"
    : trcloud.action === "failed" ? " (⚠️ TRCloud ต้องลบเอง)"
    : "";
  return { ok: true, summary: `ลบใบรับ ${grn.grnCode} · คืนสต๊อก ${reversed} รายการ${trNote}` };
}

/** ลบใบรับสินค้า (GRN) เดี่ยว. */
export async function deleteGoodsReceipt(grnId: string): Promise<DeleteDocResult> {
  const g = await requireDeleter();
  if (!g.ok) return g;
  const id = (grnId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบรับสินค้า" };

  const grn = await loadGrn(g.deleter.orgId, id);
  if (!grn) return { ok: false, error: "ไม่พบใบรับสินค้านี้ในองค์กรของคุณ" };

  const blocked = await assertReceiptsReversible(g.deleter.orgId, [id]);
  if (blocked) return { ok: false, error: blocked };

  const res = await deleteGrnCore(grn, g.deleter);
  if (res.ok) revalidateDc();
  return res;
}

// ════════════════════════════════════════════════════════════════════
// PO (ใบสั่งซื้อ) — cascade: ลบใบรับ (GRN) + shipment ที่ผูกอยู่ตามไปด้วย
// ════════════════════════════════════════════════════════════════════

/** ลบใบสั่งซื้อ (PO) + ทุกอย่างที่เกิดจากมัน (ใบรับ/สต๊อก/ต้นทุน/TRCloud/shipment/จ่ายเงิน). */
export async function deletePurchaseOrder(poId: string): Promise<DeleteDocResult> {
  const g = await requireDeleter();
  if (!g.ok) return g;
  const { orgId } = g.deleter;
  const id = (poId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    include: { lines: true, payments: true, supplier: { select: { name: true } } },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  // ใบรับ (GRN) ที่เกิดจาก PO นี้ (ไม่มี FK → query poId เอง)
  const grns = await prisma.dcGoodsReceipt.findMany({ where: { orgId, poId: id } });
  const grnIds = grns.map((x) => x.id);

  // shipment ที่ผูก PO นี้
  const shipments = await prisma.dcShipment.findMany({
    where: { orgId, poId: id },
    include: { lines: true },
  });

  // pre-flight: ใบรับทั้งหมดต้องย้อนได้ (ไม่งั้นบล็อกทั้ง PO ก่อนแตะอะไร)
  const blocked = await assertReceiptsReversible(orgId, grnIds);
  if (blocked) return { ok: false, error: blocked };

  // 1) ลบใบรับทีละใบ (คืนสต๊อก + TRCloud + log · cascadedFrom = po)
  let receiptsDeleted = 0;
  let stockReversed = 0;
  const warns: string[] = [];
  for (const grn of grns) {
    const rec = await deleteGrnCore(grn as GrnRecord, g.deleter, { fromType: "po", fromId: id });
    if (!rec.ok) return rec; // ล้ม → หยุด (ที่ลบไปแล้วเป็น idempotent · re-click ต่อได้)
    receiptsDeleted += 1;
    const m = rec.summary.match(/คืนสต๊อก (\d+)/);
    if (m) stockReversed += Number(m[1]);
    if (rec.summary.includes("TRCloud ต้องลบเอง")) warns.push(grn.grnCode);
  }

  // 2) snapshot + ลบ shipment + PO (atomic). lines/payments ของ PO cascade เอง.
  const snapshot = { po, shipments };
  await prisma.$transaction([
    prisma.dcDeletionLog.create({
      data: deletionLogData({
        orgId, docType: "po", docId: po.id, docCode: po.poCode,
        snapshot,
        reversal: { receiptsDeleted, stockReversed, shipmentsDeleted: shipments.length },
        deletedByUserId: g.deleter.userId, deletedByName: g.deleter.userName,
      }),
    }),
    prisma.dcShipment.deleteMany({ where: { orgId, poId: id } }),
    prisma.dcPurchaseOrder.delete({ where: { id: po.id } }),
  ]);

  revalidateDc();
  const parts = [`ลบใบสั่งซื้อ ${po.poCode}`];
  if (receiptsDeleted) parts.push(`ใบรับ ${receiptsDeleted} ใบ`);
  if (shipments.length) parts.push(`ใบขนส่ง ${shipments.length} ใบ`);
  if (stockReversed) parts.push(`คืนสต๊อก ${stockReversed} รายการ`);
  let summary = parts.join(" + ");
  if (warns.length) summary += ` (⚠️ TRCloud ต้องลบเอง: ${warns.join(", ")})`;
  return { ok: true, summary };
}

// ════════════════════════════════════════════════════════════════════
// Transfer (ใบโอน/ย้ายคลัง) — คืนจากรายการ movement จริง (รองรับทั้ง in-transit & confirmed)
// ════════════════════════════════════════════════════════════════════

/** ลบใบโอน + คืนสต๊อกให้กลับสภาพก่อนโอน. */
export async function deleteTransfer(transferId: string): Promise<DeleteDocResult> {
  const g = await requireDeleter();
  if (!g.ok) return g;
  const { orgId } = g.deleter;
  const id = (transferId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบโอน" };

  const transfer = await prisma.dcTransfer.findFirst({
    where: { id, orgId },
    include: { lines: true },
  });
  if (!transfer) return { ok: false, error: "ไม่พบใบโอนนี้ในองค์กรของคุณ" };

  const isOpen =
    transfer.status === DcTransferStatus.DISPATCHED ||
    transfer.status === DcTransferStatus.IN_TRANSIT;
  const alreadyCancelled = transfer.status === DcTransferStatus.CANCELLED;

  // รายการ movement จริงของใบนี้ (dc_transfer / dc_transfer_auto). ยกเลิกแล้ว = คืนไปแล้ว ไม่ย้อนซ้ำ.
  const movements = alreadyCancelled
    ? []
    : await prisma.dcStockMovement.findMany({
        where: { orgId, refType: { in: ["dc_transfer", "dc_transfer_auto"] }, refId: id },
        select: { id: true, warehouseId: true, productId: true, qty: true, kind: true, unitCostSatang: true, costLayerId: true },
      });

  let reversed = 0;
  for (const m of movements) {
    if (m.qty === 0) continue;
    // OPEN + TRANSFER_OUT → คืน onHand ต้นทาง + ล้าง in-transit. อื่น ๆ (confirmed) → คืน onHand ตามคลังนั้น.
    const clearInTransit = isOpen && m.kind === DcMoveKind.TRANSFER_OUT;
    const back = await recordMovement({
      orgId,
      warehouseId: m.warehouseId,
      productId: m.productId,
      kind: m.qty < 0 ? DcMoveKind.RETURN_IN : DcMoveKind.COUNT_ADJUST,
      qty: -m.qty,
      inTransitDelta: clearInTransit ? -Math.abs(m.qty) : 0,
      unitCostSatang: m.unitCostSatang,
      costLayerId: m.costLayerId,
      sourceKey: sourceKey("tf-del", id, m.id),
      refType: "dc_transfer_delete",
      refId: id,
      note: `ลบใบโอน ${transfer.transferCode} — คืนสต๊อกกลับ`,
      actorUserId: g.deleter.userId,
    });
    if (!back.ok) {
      return { ok: false, error: `ลบใบโอน ${transfer.transferCode} ไม่ได้: ${back.error} (ของอาจถูกใช้ที่ปลายทางแล้ว)` };
    }
    if (!back.duplicate) reversed += 1;
  }

  const snapshot = { transfer, movements };
  await prisma.$transaction([
    prisma.dcDeletionLog.create({
      data: deletionLogData({
        orgId, docType: "transfer", docId: transfer.id, docCode: transfer.transferCode,
        snapshot, reversal: { movementsReversed: reversed, wasStatus: transfer.status },
        deletedByUserId: g.deleter.userId, deletedByName: g.deleter.userName,
      }),
    }),
    prisma.dcTransfer.delete({ where: { id: transfer.id } }),
  ]);

  revalidateDc();
  return {
    ok: true,
    summary: reversed
      ? `ลบใบโอน ${transfer.transferCode} · คืนสต๊อก ${reversed} รายการ`
      : `ลบใบโอน ${transfer.transferCode}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Issue (ใบเบิกออก) — คืนของที่เบิกกลับเข้าคลัง
// ════════════════════════════════════════════════════════════════════

/** ลบใบเบิก + คืนของที่เบิกออกกลับเข้าคลัง. */
export async function deleteIssue(issueId: string): Promise<DeleteDocResult> {
  const g = await requireDeleter();
  if (!g.ok) return g;
  const { orgId } = g.deleter;
  const id = (issueId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบเบิก" };

  const issue = await prisma.dcIssue.findFirst({ where: { id, orgId } });
  if (!issue) return { ok: false, error: "ไม่พบใบเบิกนี้ในองค์กรของคุณ" };

  const movements = await prisma.dcStockMovement.findMany({
    where: { orgId, refType: "dc_issue", refId: id },
    select: { id: true, warehouseId: true, productId: true, qty: true, unitCostSatang: true, costLayerId: true },
  });

  // เบิกออก qty เป็นลบ → คืน qty บวก (RETURN_IN). ไม่มีทางติดลบ.
  let reversed = 0;
  for (const m of movements) {
    if (m.qty === 0) continue;
    const back = await recordMovement({
      orgId,
      warehouseId: m.warehouseId,
      productId: m.productId,
      kind: DcMoveKind.RETURN_IN,
      qty: -m.qty,
      unitCostSatang: m.unitCostSatang,
      costLayerId: m.costLayerId,
      sourceKey: sourceKey("issue-del", id, m.id),
      refType: "dc_issue_delete",
      refId: id,
      note: `ลบใบเบิก ${issue.issueCode} — คืนของกลับเข้าคลัง`,
      actorUserId: g.deleter.userId,
    });
    if (!back.ok) return { ok: false, error: `ลบใบเบิก ${issue.issueCode} ไม่ได้: ${back.error}` };
    if (!back.duplicate) reversed += 1;
  }

  const snapshot = { issue, movements };
  await prisma.$transaction([
    prisma.dcDeletionLog.create({
      data: deletionLogData({
        orgId, docType: "issue", docId: issue.id, docCode: issue.issueCode,
        snapshot, reversal: { movementsReversed: reversed },
        deletedByUserId: g.deleter.userId, deletedByName: g.deleter.userName,
      }),
    }),
    prisma.dcIssue.delete({ where: { id: issue.id } }),
  ]);

  revalidateDc();
  return {
    ok: true,
    summary: reversed
      ? `ลบใบเบิก ${issue.issueCode} · คืนของ ${reversed} รายการ`
      : `ลบใบเบิก ${issue.issueCode}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Move (ใบย้ายที่) — qty 0 (ตำแหน่งเท่านั้น) → ไม่ต้องคืนสต๊อก
// ════════════════════════════════════════════════════════════════════

/** ลบใบย้ายที่ (ไม่กระทบจำนวนสินค้า — เป็นการย้ายตำแหน่งจัดเก็บ). */
export async function deleteMove(moveId: string): Promise<DeleteDocResult> {
  const g = await requireDeleter();
  if (!g.ok) return g;
  const { orgId } = g.deleter;
  const id = (moveId ?? "").trim();
  if (!id) return { ok: false, error: "ไม่พบใบย้ายที่" };

  const move = await prisma.dcMove.findFirst({ where: { id, orgId } });
  if (!move) return { ok: false, error: "ไม่พบใบย้ายที่นี้ในองค์กรของคุณ" };

  const movements = await prisma.dcStockMovement.findMany({
    where: { orgId, refType: "dc_move", refId: id },
    select: { id: true, warehouseId: true, productId: true, qty: true, locationFrom: true, locationTo: true },
  });

  const snapshot = { move, movements };
  await prisma.$transaction([
    prisma.dcDeletionLog.create({
      data: deletionLogData({
        orgId, docType: "move", docId: move.id, docCode: move.moveCode,
        snapshot, reversal: { note: "ย้ายที่ = ไม่กระทบจำนวน (ตำแหน่งจัดเก็บคงไว้ตามปัจจุบัน)" },
        deletedByUserId: g.deleter.userId, deletedByName: g.deleter.userName,
      }),
    }),
    prisma.dcMove.delete({ where: { id: move.id } }),
  ]);

  revalidateDc();
  return { ok: true, summary: `ลบใบย้ายที่ ${move.moveCode}` };
}
