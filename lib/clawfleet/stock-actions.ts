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

const STOCK_PATH = "/clawfleet/os/stock";
const ANOMALY_PATH = "/clawfleet/os/collections";

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

/**
 * ยอดคงคลัง "ในคลังสาขา" (warehouse) ของ product = ผลรวม signed qty ใน ledger
 * เฉพาะ movement ที่ machineId = null (ไม่นับของที่อยู่ในตู้) — match นิยาม warehouse
 * ใน stock-queries.ts (getCfBranchStockProducts ใช้ machineId: null เป็น warehouse).
 * ใช้กับ count / withdraw / transfer / receive ซึ่งทำกับคลังสาขาทั้งหมด.
 */
async function currentBalance(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  orgId: string,
  branchId: string,
  productId: string,
): Promise<number> {
  const agg = await tx.cfStockMovement.aggregate({
    where: { orgId, branchId, productId, machineId: null },
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

      // รวมรายการที่เป็นสินค้าตัวเดียวกัน (ป้องกัน 2 บรรทัด productId ซ้ำ →
      // ต้นทุนเฉลี่ยถ่วงน้ำหนัก double-count). รวม qty + ต้นทุนรวมต่อ product ก่อน loop
      // และ snapshot ยอดเดิม (warehouse + org) ครั้งเดียวก่อนเขียน movement ใด ๆ.
      let total = 0;
      const agg = new Map<
        string,
        { id: string; name: string; oldCost: number; qty: number; costTotal: number }
      >();
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
        total += l.unitCostCents * l.quantity;
        const cur = agg.get(p.id);
        if (cur) {
          cur.qty += l.quantity;
          cur.costTotal += l.unitCostCents * l.quantity;
        } else {
          agg.set(p.id, {
            id: p.id,
            name: p.name,
            oldCost: p.unitCostCents,
            qty: l.quantity,
            costTotal: l.unitCostCents * l.quantity,
          });
        }
      }

      const work: Array<{
        id: string; name: string; oldCost: number; qty: number;
        unit: number; oldBal: number; orgQtyBefore: number;
      }> = [];
      for (const a of agg.values()) {
        // 🔒 B3 · ล็อกต่อ product — serialize การคำนวณต้นทุนเฉลี่ยถ่วงน้ำหนัก (transaction-level →
        // ปลดอัตโนมัติตอน commit/rollback). กัน 2 การรับเข้าสินค้าตัวเดียวกันพร้อมกัน อ่าน orgQtyBefore/
        // ต้นทุนเดิมก้อนเดียวกัน แล้วเขียนทับ cfProduct.unitCostCents ของกันและกัน (lost update).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.id}))`;
        // ต้นทุนเฉลี่ยของรายการรับเข้าครั้งนี้ (รวมทุกบรรทัดของ product เดียวกัน)
        const unit = a.qty > 0 ? Math.round(a.costTotal / a.qty) : a.oldCost;
        // B2 · ห้ามต้นทุน 0 (หรือติดลบ) ไปเจือจางต้นทุนเฉลี่ยถ่วงน้ำหนัก — mirror guard ของ
        // confirmShipmentReceived. ถ้าสินค้ายังไม่มีต้นทุนเดิมให้ fallback → reject ทั้งใบ.
        // (ถ้ามีต้นทุนเดิม > 0 เราจะใช้ต้นทุนเดิมแทน ไม่ให้ 0 ทับของเดิม — ดูใน update loop)
        if (unit <= 0 && a.oldCost <= 0) {
          throw new Error(
            `สินค้า "${a.name}" ยังไม่ได้ตั้งราคาทุน · ตั้งราคาทุนก่อนรับเข้าคลัง`,
          );
        }
        // 🔒 อ่าน orgQtyBefore/ยอดคงคลัง "ภายใน lock" — ค่านี้คือความจริง ณ ขณะถือ lock (ไม่มีใครแทรก)
        const oldBal = await currentBalance(tx, orgId, branchId, a.id);
        const totalQtyAcrossOrg = await tx.cfStockMovement.aggregate({
          where: { orgId, productId: a.id },
          _sum: { qty: true },
        });
        const orgQtyBefore = totalQtyAcrossOrg._sum.qty ?? 0;
        work.push({ id: a.id, name: a.name, oldCost: a.oldCost, qty: a.qty, unit, oldBal, orgQtyBefore });
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
        // B2 · ถ้ารายการรับเข้าครั้งนี้ไม่มีต้นทุน (unit ≤ 0) แต่สินค้ามีต้นทุนเดิม > 0 อยู่แล้ว
        // → ห้ามให้ 0 มาเจือจาง/ทับต้นทุนเฉลี่ย · ใช้ต้นทุนเดิมเป็นต้นทุนของรายการนี้แทน
        // (กรณีไม่มีต้นทุนเดิมเลยถูก reject ไปแล้วใน work loop ด้านบน)
        const effUnit = w.unit > 0 ? w.unit : w.oldCost;
        // ต้นทุนเฉลี่ยถ่วงน้ำหนัก = (ของเก่า×ต้นทุนเก่า + ของใหม่×ต้นทุนใหม่) / รวม
        // ใช้ orgQtyBefore ที่ snapshot ครั้งเดียวก่อน loop (ไม่ re-aggregate กลาง loop
        // → ถ้ามี product ซ้ำหลายบรรทัด เรารวมเป็น w เดียวแล้ว ไม่ double-count)
        const orgQtyBefore = w.orgQtyBefore;
        const avgCost = orgQtyBefore + w.qty > 0
          ? Math.round((w.oldCost * Math.max(0, orgQtyBefore) + effUnit * w.qty) / (Math.max(0, orgQtyBefore) + w.qty))
          : effUnit;
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
  revalidatePath("/clawfleet/os/dashboard");
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
            // ⚠️ ต้องมี branchId ของใบนับ — ไม่งั้น session กำพร้า:
            // listV2Anomalies / getV2SessionDetail กรอง branchId ตามสิทธิ์ user (non-admin)
            // → ถ้า null คนตรวจ anomaly จะมองไม่เห็น/เปิดไม่ได้ (sentinel หลุดเข้า DB เปล่า ๆ)
            branchId, // = branchId ที่ validate จากใบนับ (CountSchema.branchId · UUID)
            groupId: null, // sentinel จากนับสต๊อก = ผูกกับสาขา ไม่ใช่ legacy machine-group
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
  revalidatePath("/clawfleet/os/dashboard");
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
  revalidatePath("/clawfleet/os/dashboard");
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
// 7) ใบกระจายสินค้า (delivery / shipment) คลังกลาง → สาขา
//    createShipment: สร้างใบ (status SCHEDULED) + รายการสินค้า (cf_delivery_lines)
//    confirmShipmentReceived: ตั้ง receivedQty + status DELIVERED + รับเข้าสต๊อกสาขา
//      (RECEIPT_IN movement เดียวกับ receiveStock) · idempotent: ถ้า DELIVERED แล้ว → no-op
// =============================================================
const CreateShipmentSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  fromLocation: z.string().trim().max(200).optional(),
  eta: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
      }),
    )
    .min(1, "ยังไม่ได้ใส่รายการสินค้าในใบกระจาย"),
});

export async function createShipment(input: unknown): Promise<Result<{ deliveryId: string }>> {
  const parsed = CreateShipmentSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { branchId, fromLocation, eta, note, lines } = parsed.data;

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
        select: { id: true, name: true },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));

      // รวม qty ของ product ที่ซ้ำบรรทัด → 1 line ต่อ product (กันใบกระจายมีสินค้าซ้ำ)
      const agg = new Map<string, { id: string; name: string; qty: number }>();
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
        const cur = agg.get(p.id);
        if (cur) cur.qty += l.qty;
        else agg.set(p.id, { id: p.id, name: p.name, qty: l.qty });
      }
      const work = Array.from(agg.values());
      const itemsCount = work.length;
      const unitsCount = work.reduce((s, w) => s + w.qty, 0);

      const delivery = await tx.cfDelivery.create({
        data: {
          orgId,
          branchId,
          status: "SCHEDULED",
          fromLocation: fromLocation || undefined,
          eta: eta ? new Date(eta) : null,
          itemsCount,
          unitsCount,
          note: note || null,
          createdById: session.user.id,
          lines: {
            create: work.map((w) => ({
              orgId,
              productId: w.id,
              productName: w.name,
              qty: w.qty,
            })),
          },
        },
        select: { id: true },
      });
      return { deliveryId: delivery.id };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: result };
}

const ConfirmShipmentSchema = z.object({
  deliveryId: z.string().uuid("ใบกระจายไม่ถูกต้อง"),
  receivedLines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        receivedQty: z.coerce.number().int().min(0),
      }),
    )
    .min(1, "ยังไม่ได้ใส่จำนวนที่รับ"),
});

export async function confirmShipmentReceived(
  input: unknown,
): Promise<Result<{ deliveryId: string; status: string; alreadyReceived: boolean }>> {
  const parsed = ConfirmShipmentSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { deliveryId, receivedLines } = parsed.data;

  // หา branchId ของใบก่อน เพื่อ assert สิทธิ์ตามสาขา
  const head = await prisma.cfDelivery.findFirst({
    where: { id: deliveryId },
    select: { id: true, orgId: true, branchId: true, status: true },
  });
  if (!head) return err("ไม่พบใบกระจาย");

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(head.branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;
  if (head.orgId !== orgId) return err("ไม่มีสิทธิ์เข้าถึงใบกระจายนี้");

  // idempotent guard (นอก tx · เร็ว) — รับแล้วห้ามรับซ้ำ
  if (head.status === "DELIVERED") {
    return { ok: true, data: { deliveryId, status: "DELIVERED", alreadyReceived: true } };
  }

  const recvMap = new Map(receivedLines.map((r) => [r.lineId, r.receivedQty]));

  const result = await prisma
    .$transaction(async (tx) => {
      // re-read สถานะ + lines ใน tx (กัน race: 2 คนกดยืนยันพร้อมกัน → คนหลัง no-op)
      const d = await tx.cfDelivery.findFirst({
        where: { id: deliveryId, orgId },
        select: {
          id: true,
          branchId: true,
          status: true,
          lines: { select: { id: true, productId: true, productName: true, qty: true } },
        },
      });
      if (!d) throw new Error("ไม่พบใบกระจาย");
      if (d.status === "DELIVERED") {
        return { status: "DELIVERED", alreadyReceived: true };
      }

      // 🔒 atomic claim (กัน double-receive · 2 คนกดยืนยันใบเดียวพร้อมกัน):
      // updateMany ที่มีเงื่อนไข status ≠ DELIVERED จะล็อกแถว → คนที่สองรอ แล้ว Postgres re-check
      // WHERE กับค่าใหม่ (DELIVERED) = match 0 แถว → count=0 → no-op ไม่เขียน movement ซ้ำ.
      // ถ้า throw ภายหลัง (เช่นต้นทุน 0) tx rollback → claim ถูกยกเลิก สถานะกลับเป็นเดิม.
      const claim = await tx.cfDelivery.updateMany({
        where: { id: d.id, orgId, status: { not: "DELIVERED" } },
        data: { status: "DELIVERED" },
      });
      if (claim.count !== 1) {
        return { status: "DELIVERED", alreadyReceived: true };
      }

      // ต้นทุนต่อชิ้น = ต้นทุนเฉลี่ยปัจจุบันของสินค้า (ห้าม 0 → ทำต้นทุนเฉลี่ยถ่วงน้ำหนักเพี้ยน)
      const ids = d.lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, unitCostCents: true },
      });
      const costMap = new Map(products.map((p) => [p.id, p.unitCostCents]));
      const nameMap = new Map(products.map((p) => [p.id, p.name]));

      // รวมจำนวนรับจริงต่อ product (กัน product ซ้ำหลาย line) + snapshot ยอด org ก่อนเขียน
      const agg = new Map<string, { id: string; qty: number; cost: number }>();
      for (const ln of d.lines) {
        const recv = recvMap.get(ln.id);
        // clamp ≤ qty ในใบ (รับเกินจำนวนที่ส่งไม่ได้) · ไม่ส่งจำนวนมา = รับครบตามใบ
        const qty = recv == null ? ln.qty : Math.min(recv, ln.qty);
        await tx.cfDeliveryLine.update({ where: { id: ln.id }, data: { receivedQty: qty } });
        if (qty <= 0) continue;
        const cost = costMap.get(ln.productId) ?? 0;
        if (cost <= 0) {
          // reject ทั้งใบ (rollback claim) แทนเขียน movement ทุน 0 ที่ทำต้นทุนเฉลี่ยเพี้ยน
          throw new Error(
            `สินค้า "${nameMap.get(ln.productId) ?? ln.productName}" ยังไม่ได้ตั้งราคาทุน · ตั้งราคาทุนก่อนรับเข้าคลัง`,
          );
        }
        const cur = agg.get(ln.productId);
        if (cur) cur.qty += qty;
        else agg.set(ln.productId, { id: ln.productId, qty, cost });
      }

      // รับเข้าสต๊อกสาขา — RECEIPT_IN movement (machineId null = คลังสาขา) · ตรรกะเดียวกับ receiveStock
      const now = new Date();
      for (const a of agg.values()) {
        const oldBal = await currentBalance(tx, orgId, d.branchId, a.id);
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: d.branchId,
            type: "RECEIPT_IN",
            productId: a.id,
            qty: a.qty,
            unitCostCents: a.cost,
            occurredAt: now,
            createdById: session.user.id,
            refTable: "cf_deliveries",
            refId: d.id,
            documentType: "transfer",
            documentId: d.id,
            reason: `ตรวจรับใบกระจาย · คงเหลือ ${oldBal + a.qty}`,
          },
        });
      }

      // (สถานะ DELIVERED ถูกตั้งแล้วตอน claim ด้านบน)
      return { status: "DELIVERED", alreadyReceived: false };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: { deliveryId, status: result.status, alreadyReceived: result.alreadyReceived } };
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
