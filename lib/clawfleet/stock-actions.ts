"use server";

// ClawFleet · คลังสินค้าเต็มระบบ (WMS) — fork ของ Playland stock pattern
//   รับเข้า (goods receipt · weighted-avg cost) · นับสต๊อก (cycle count + นับต่าง→Anomaly)
//   ของหาย (loss/write-off) · โอนระหว่างสาขา (transfer)
// ทุกการเข้า-ออกบันทึกใน cf_stock_movements (ledger · signed qty + balanceAfter + doc link)
// ทุก action: assertCfAdmin / branch-scope · Zod · transaction · idempotent guard · revalidate

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCfAdmin, userBranchIds } from "./role-guard";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

const STOCK_PATH = "/clawfleet/v2/stock";
const ANOMALY_PATH = "/clawfleet/v2/anomaly";

// ── code-gen (human-readable · BE year · timestamp+random suffix · กันชนต่ำ) ──
function beYearTwo(): string {
  return String(new Date().getFullYear() + 543).slice(-2);
}
function suffix(): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${ts}${rnd}`;
}
function newReceiptCode() { return `GR-${beYearTwo()}-${suffix()}`; }
function newCountCode() { return `SC-${beYearTwo()}-${suffix()}`; }
function newLossCode() { return `LS-${beYearTwo()}-${suffix()}`; }
function newTransferCode() { return `TF-${beYearTwo()}-${suffix()}`; }

// ── branch-access: คืน session + ยืนยันสิทธิ์เข้าถึงสาขา (admin = ทุกสาขา) ──
async function assertBranchAccess(branchId: string) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(branchId)) {
    throw new Error("ไม่มีสิทธิ์เข้าถึงสาขานี้");
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) throw new Error("ไม่พบสาขาตู้คีบ");
  return { session, orgId };
}

// ── ยิงบาร์โค้ด → หาสินค้าในคลัง (USB scanner = พิมพ์โค้ด+Enter · กล้อง = string เดียวกัน) ──
export interface CfBarcodeHit {
  id: string;
  sku: string;
  name: string;
  unitCostCents: number;
  imageUrl: string | null;
}
export async function lookupCfProductByBarcode(
  input: { barcode: string },
): Promise<Result<CfBarcodeHit>> {
  const session = await requireSession();
  const code = (input.barcode ?? "").trim();
  if (!code) return err("ไม่มีบาร์โค้ด");
  const p = await prisma.cfProduct.findFirst({
    where: { orgId: session.user.org_id, barcode: code, isActive: true },
    select: { id: true, sku: true, name: true, unitCostCents: true, imageUrl: true },
  });
  if (!p) return err(`ไม่พบสินค้าบาร์โค้ด ${code}`);
  return { ok: true, data: p };
}

// =============================================================
// 1) รับของเข้า (goods receipt) → สต๊อก... จริงๆ ClawFleet สต๊อก = ผลรวม ledger
//    (ไม่มีคอลัมน์ stock บน cf_products) → ต้นทุนเฉลี่ยถ่วงน้ำหนัก update บน product
// =============================================================
const ReceiveSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  supplierName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
        unitCostCents: z.coerce.number().int().min(0),
      }),
    )
    .min(1, "ยังไม่ได้ใส่รายการรับเข้า"),
});

/** ยอดคงคลังปัจจุบันของ product ในสาขา = ผลรวม signed qty ใน ledger */
async function currentBalance(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  orgId: string,
  branchId: string,
  productId: string,
): Promise<number> {
  const agg = await tx.cfStockMovement.aggregate({
    where: { orgId, branchId, productId },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? 0;
}

export async function receiveStock(input: unknown): Promise<Result<{ receiptCode: string; receiptId: string; totalCostCents: number }>> {
  const parsed = ReceiveSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { branchId, supplierName, note, photoUrls, lines } = parsed.data;

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;

  const result = await prisma
    .$transaction(async (tx) => {
      const ids = lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, unitCostCents: true },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));

      let total = 0;
      const work: Array<{ id: string; name: string; oldCost: number; qty: number; unit: number; oldBal: number }> = [];
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
        total += l.unitCostCents * l.quantity;
        const oldBal = await currentBalance(tx, orgId, branchId, p.id);
        work.push({ id: p.id, name: p.name, oldCost: p.unitCostCents, qty: l.quantity, unit: l.unitCostCents, oldBal });
      }

      const receipt = await tx.cfGoodsReceipt.create({
        data: {
          orgId,
          branchId,
          receiptCode: newReceiptCode(),
          supplierName: supplierName || null,
          note: note || null,
          totalCostCents: total,
          status: "RECEIVED",
          photoUrls: photoUrls ?? [],
          createdById: session.user.id,
          lines: {
            create: work.map((w) => ({
              orgId,
              productId: w.id,
              productName: w.name,
              quantity: w.qty,
              unitCostCents: w.unit,
            })),
          },
        },
        select: { id: true, receiptCode: true },
      });

      for (const w of work) {
        const newBal = w.oldBal + w.qty;
        // ต้นทุนเฉลี่ยถ่วงน้ำหนัก = (ของเก่า×ต้นทุนเก่า + ของใหม่×ต้นทุนใหม่) / รวม
        const totalQtyAcrossOrg = await tx.cfStockMovement.aggregate({
          where: { orgId, productId: w.id },
          _sum: { qty: true },
        });
        const orgQtyBefore = totalQtyAcrossOrg._sum.qty ?? 0;
        const avgCost = orgQtyBefore + w.qty > 0
          ? Math.round((w.oldCost * Math.max(0, orgQtyBefore) + w.unit * w.qty) / (Math.max(0, orgQtyBefore) + w.qty))
          : w.unit;
        await tx.cfProduct.update({ where: { id: w.id }, data: { unitCostCents: avgCost } });
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId,
            type: "RECEIPT_IN",
            productId: w.id,
            qty: w.qty,
            unitCostCents: w.unit,
            // balanceAfter — เก็บใน reason เป็น context; ClawFleet schema ไม่มี balanceAfter
            occurredAt: new Date(),
            createdById: session.user.id,
            refTable: "cf_goods_receipts",
            refId: receipt.id,
            documentType: "goods_receipt",
            documentId: receipt.id,
            photoUrls: photoUrls ?? [],
            reason: `รับเข้า · คงเหลือ ${newBal}`,
          },
        });
      }

      return { receiptId: receipt.id, receiptCode: receipt.receiptCode, totalCostCents: total };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/v2/hub");
  return { ok: true, data: result };
}

// =============================================================
// 2) นับสต๊อก (cycle count) — บันทึกใบ + ปรับยอด + ledger COUNT_ADJUST
//    นับต่างเกิน threshold → สร้าง sentinel session ANOMALY_REVIEW (เด้งเข้า Anomaly)
// =============================================================
const VARIANCE_ANOMALY_THRESHOLD = 5; // |ผลต่างรวม| ≥ 5 ตัว → flag anomaly

const CountSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        countedQty: z.coerce.number().int().min(0),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, "ยังไม่ได้ใส่รายการนับ"),
});

export async function submitStockCount(input: unknown): Promise<Result<{ countCode: string | null; countId: string | null; adjusted: number; skipped: number; anomaly: boolean }>> {
  const parsed = CountSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { branchId, note, lines } = parsed.data;

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;

  const result = await prisma
    .$transaction(async (tx) => {
      const ids = lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, unitCostCents: true },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));

      let skipped = 0;
      const diffs: Array<{ id: string; name: string; before: number; after: number; diff: number; reason: string; cost: number }> = [];
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) { skipped++; continue; }
        const before = await currentBalance(tx, orgId, branchId, p.id);
        if (l.countedQty === before) { skipped++; continue; }
        diffs.push({
          id: p.id,
          name: p.name,
          before,
          after: l.countedQty,
          diff: l.countedQty - before,
          reason: l.reason ?? "",
          cost: p.unitCostCents,
        });
      }

      if (diffs.length === 0) {
        return { countId: null as string | null, countCode: null as string | null, adjusted: 0, skipped, anomaly: false };
      }

      const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);
      const count = await tx.cfStockCount.create({
        data: {
          orgId,
          branchId,
          countCode: newCountCode(),
          note: note || null,
          itemsCounted: diffs.length,
          totalDiff,
          countedById: session.user.id,
          countedByName: session.user.name || session.user.email || null,
          lines: {
            create: diffs.map((d) => ({
              orgId,
              productId: d.id,
              productName: d.name,
              systemQty: d.before,
              countedQty: d.after,
              diff: d.diff,
              reason: d.reason || null,
            })),
          },
        },
        select: { id: true, countCode: true },
      });

      for (const d of diffs) {
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId,
            type: "COUNT_ADJUST",
            productId: d.id,
            qty: d.diff, // signed delta (+/-)
            expectedQty: d.before,
            varianceQty: d.diff,
            occurredAt: new Date(),
            createdById: session.user.id,
            refTable: "cf_stock_counts",
            refId: count.id,
            documentType: "stock_count",
            documentId: count.id,
            reason: d.reason || `นับต่าง · ${d.before}→${d.after}`,
          },
        });
      }

      // นับต่างมาก → สร้าง sentinel anomaly session (เด้งเข้าหน้า Anomaly ที่มีอยู่แล้ว)
      let anomaly = false;
      if (Math.abs(totalDiff) >= VARIANCE_ANOMALY_THRESHOLD) {
        anomaly = true;
        const lossCount = diffs.reduce((s, d) => s + (d.diff < 0 ? -d.diff : 0), 0);
        const flagText = `นับสต๊อกต่างจากระบบ ${totalDiff >= 0 ? "+" : ""}${totalDiff} ตัว (ใบ ${count.countCode})`;
        await tx.cfCollectionSession.create({
          data: {
            orgId,
            branchId,
            sessionCode: `SC-ANOM-${count.countCode}`,
            openedAt: new Date(),
            openedById: session.user.id,
            closedAt: new Date(),
            closedById: session.user.id,
            status: "ANOMALY_REVIEW",
            prizeMeterOut: diffs.reduce((s, d) => s + d.before, 0),
            prizeCountedOut: diffs.reduce((s, d) => s + d.after, 0),
            prizeVariance: totalDiff,
            anomalyFlags: [flagText],
          },
        });
        void lossCount;
      }

      return { countId: count.id, countCode: count.countCode, adjusted: diffs.length, skipped, anomaly };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath(ANOMALY_PATH);
  revalidatePath("/clawfleet/v2/hub");
  return { ok: true, data: result };
}

// =============================================================
// 3) ของหาย / เสียหาย / ตัดทิ้ง (loss / write-off) → ledger LOSS_ADJUST (negative)
// =============================================================
const LossSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  reason: z.enum(["DAMAGE", "THEFT", "OBSOLETE", "OTHER"]),
  note: z.string().trim().max(500).optional(),
  photoUrls: z.array(z.string().url()).max(10).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, "ยังไม่ได้ใส่รายการของหาย"),
});

export async function recordLoss(input: unknown): Promise<Result<{ lossCode: string; lossId: string; totalCostCents: number }>> {
  const parsed = LossSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { branchId, reason, note, photoUrls, lines } = parsed.data;

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;

  const result = await prisma
    .$transaction(async (tx) => {
      const ids = lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, unitCostCents: true },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));

      let total = 0;
      const work: Array<{ id: string; name: string; qty: number; cost: number; note: string }> = [];
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
        total += p.unitCostCents * l.qty;
        work.push({ id: p.id, name: p.name, qty: l.qty, cost: p.unitCostCents, note: l.note ?? "" });
      }

      const loss = await tx.cfLossDoc.create({
        data: {
          orgId,
          branchId,
          lossCode: newLossCode(),
          reason,
          note: note || null,
          totalCostCents: total,
          photoUrls: photoUrls ?? [],
          reportedById: session.user.id,
          lines: {
            create: work.map((w) => ({
              orgId,
              productId: w.id,
              productName: w.name,
              qty: w.qty,
              unitCostCents: w.cost,
              note: w.note || null,
            })),
          },
        },
        select: { id: true, lossCode: true },
      });

      for (const w of work) {
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId,
            type: "LOSS_ADJUST",
            productId: w.id,
            qty: -w.qty, // negative — ของหายออกจากคลัง
            unitCostCents: w.cost,
            occurredAt: new Date(),
            createdById: session.user.id,
            refTable: "cf_loss_docs",
            refId: loss.id,
            documentType: "loss_doc",
            documentId: loss.id,
            photoUrls: photoUrls ?? [],
            reason: w.note || `ของหาย/เสียหาย (${reason})`,
          },
        });
      }

      return { lossId: loss.id, lossCode: loss.lossCode, totalCostCents: total };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/v2/hub");
  return { ok: true, data: result };
}

// =============================================================
// 4) โอนระหว่างสาขา (transfer) → 2 ledger moves (TRANSFER_OUT − / TRANSFER_IN +) ใน 1 tx
// =============================================================
const TransferSchema = z.object({
  fromBranchId: z.string().uuid("สาขาต้นทางไม่ถูกต้อง"),
  toBranchId: z.string().uuid("สาขาปลายทางไม่ถูกต้อง"),
  productId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
  note: z.string().trim().max(300).optional(),
});

export async function transferStock(input: unknown): Promise<Result<{ transferCode: string }>> {
  const parsed = TransferSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { fromBranchId, toBranchId, productId, qty, note } = parsed.data;
  if (fromBranchId === toBranchId) return err("สาขาต้นทางและปลายทางต้องต่างกัน");

  // ต้องเข้าถึงได้ทั้งสองสาขา (admin = ผ่านทั้งหมด)
  try {
    await assertBranchAccess(fromBranchId);
    await assertBranchAccess(toBranchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const session = await requireSession();
  const orgId = session.user.org_id;

  const product = await prisma.cfProduct.findFirst({
    where: { id: productId, orgId },
    select: { id: true, name: true, unitCostCents: true },
  });
  if (!product) return err("ไม่พบสินค้า");

  const transferCode = newTransferCode();
  const result = await prisma
    .$transaction(async (tx) => {
      const fromBal = await currentBalance(tx, orgId, fromBranchId, productId);
      if (fromBal < qty) throw new Error(`สาขาต้นทางเหลือ ${fromBal} ไม่พอโอน ${qty}`);
      const now = new Date();
      await tx.cfStockMovement.create({
        data: {
          orgId, branchId: fromBranchId, type: "TRANSFER_OUT", productId,
          qty: -qty, unitCostCents: product.unitCostCents, occurredAt: now,
          createdById: session.user.id, documentType: "transfer", reason: note || `โอนออก → สาขาปลายทาง (${transferCode})`,
        },
      });
      await tx.cfStockMovement.create({
        data: {
          orgId, branchId: toBranchId, type: "TRANSFER_IN", productId,
          qty: qty, unitCostCents: product.unitCostCents, occurredAt: now,
          createdById: session.user.id, documentType: "transfer", reason: note || `โอนเข้า ← สาขาต้นทาง (${transferCode})`,
        },
      });
      return { transferCode };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  return { ok: true, data: result };
}

// =============================================================
// 5) เบิก/ตัดจ่าย (withdraw) — ตัดสต๊อกออกแบบมีเหตุผล (ใช้งานภายใน · ไม่ใช่ขาย/หาย)
// =============================================================
const WithdrawSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  productId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
  reason: z.string().trim().max(300).optional(),
});

export async function withdrawStock(input: unknown): Promise<Result<{ balanceAfter: number }>> {
  const parsed = WithdrawSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { branchId, productId, qty, reason } = parsed.data;

  try {
    await assertBranchAccess(branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const session = await requireSession();
  const orgId = session.user.org_id;

  const product = await prisma.cfProduct.findFirst({
    where: { id: productId, orgId }, select: { id: true, unitCostCents: true },
  });
  if (!product) return err("ไม่พบสินค้า");

  const result = await prisma
    .$transaction(async (tx) => {
      const bal = await currentBalance(tx, orgId, branchId, productId);
      if (bal < qty) throw new Error(`คลังเหลือ ${bal} ไม่พอเบิก ${qty}`);
      await tx.cfStockMovement.create({
        data: {
          orgId, branchId, type: "WITHDRAW", productId,
          qty: -qty, unitCostCents: product.unitCostCents, occurredAt: new Date(),
          createdById: session.user.id, reason: reason || "เบิกใช้งาน",
        },
      });
      return { balanceAfter: bal - qty };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  return { ok: true, data: result };
}

// =============================================================
// 6) สินค้าตัวอย่าง (idempotent) — ให้คลังมีของให้รับเข้า/นับ/ตัด
// =============================================================
const CF_SAMPLE_PRODUCTS: Array<{ sku: string; barcode: string; name: string; category: "PLUSH" | "TOY" | "KEYCHAIN" | "MODEL"; costBaht: number }> = [
  { sku: "CF-BEAR-BR", barcode: "8851000010017", name: "หมีบราวน์ ตัวใหญ่", category: "PLUSH", costBaht: 110 },
  { sku: "CF-CAT-WH", barcode: "8851000010024", name: "ตุ๊กตาแมวขาว", category: "PLUSH", costBaht: 120 },
  { sku: "CF-DOG-SH", barcode: "8851000010031", name: "หมาชิบะ ขนาดกลาง", category: "PLUSH", costBaht: 95 },
  { sku: "CF-KEY-STAR", barcode: "8851000010048", name: "พวงกุญแจดาว LED", category: "KEYCHAIN", costBaht: 35 },
  { sku: "CF-MDL-CAR", barcode: "8851000010055", name: "โมเดลรถสปอร์ต", category: "MODEL", costBaht: 150 },
];

export async function seedCfSampleProducts(): Promise<Result<{ created: number; skipped: number }>> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;
  const skus = CF_SAMPLE_PRODUCTS.map((s) => s.sku);
  const existing = await prisma.cfProduct.findMany({
    where: { orgId, sku: { in: skus } }, select: { sku: true },
  });
  const have = new Set(existing.map((e) => e.sku));
  const toCreate = CF_SAMPLE_PRODUCTS.filter((s) => !have.has(s.sku));
  if (toCreate.length === 0) return { ok: true, data: { created: 0, skipped: CF_SAMPLE_PRODUCTS.length } };

  await prisma.$transaction(async (tx) => {
    for (const s of toCreate) {
      await tx.cfProduct.create({
        data: {
          orgId, sku: s.sku, barcode: s.barcode, name: s.name,
          category: s.category, unitCostCents: s.costBaht * 100, isActive: true,
        },
      });
    }
  });
  revalidatePath(STOCK_PATH);
  return { ok: true, data: { created: toCreate.length, skipped: CF_SAMPLE_PRODUCTS.length - toCreate.length } };
}
