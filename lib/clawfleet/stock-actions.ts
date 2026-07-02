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
import { assertCfAdmin, userBranchIds, isCfAdmin, isCfBranchManager } from "./role-guard";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

const STOCK_PATH = "/clawfleet/os/stock";
const ANOMALY_PATH = "/clawfleet/os/collections";

// ── D1 (audit 2026-07-01) · maker-checker การตัดของเสีย/ปรับยอด ─────────────
// ตัดของเสีย/ของหาย (recordLoss) และปรับยอดนับกายภาพ (submitStockCount) เดิมมีแค่
// assertBranchAccess (เป็นสมาชิกสาขา) → พนักงานเก็บของคนเดียวตัดของออกเท่าไหร่ก็ได้
// และซ่อน shrinkage (นับให้ยอดลด) ได้โดยไม่มีคนที่ 2 เห็น. แก้ 2 ชั้น:
//   1) role-rank guard — เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่ "สร้าง" ใบตัด/ปรับยอดใหญ่ได้
//   2) มูลค่าเกินเกณฑ์ → ใบตัดของเสียเข้าสถานะ PENDING (รอคนที่ 2 อนุมัติ) และ
//      "ยังไม่ตัดสต๊อกจริง" จนกว่าจะ APPROVED → กันซ่อนของหายก่อนมีคนตรวจ
const LOSS_APPROVAL_THRESHOLD_CENTS = 50000; // ฿500 — เกินนี้ต้องมีคนที่ 2 อนุมัติ

// ── Wave 4b · maker-checker การนับสต๊อกปรับยอดมูลค่าสูง (mirror recordLoss/reviewCfLoss) ─────
// นับสต๊อกปรับยอด = เขียน COUNT_ADJUST movement ปรับสต๊อกได้ตรง ๆ (ปรับยอดลง = ซ่อน shrinkage ได้).
// มูลค่าปรับ (Σ |line.diff × ต้นทุน|) เกินเกณฑ์ → ใบเข้าสถานะ PENDING (รอคนที่ 2) และ
// "ยังไม่เขียน movement ปรับสต๊อกจริง" จนกว่าจะ APPROVED — เหมือน recordLoss ทุกประการ.
const STOCKCOUNT_APPROVAL_CENTS = 50000; // ฿500 — มูลค่าปรับเกินนี้ต้องมีคนที่ 2 อนุมัติ

/** ผู้ที่มีสิทธิ์ "สร้าง/อนุมัติ" การตัดของเสีย/ปรับยอดใหญ่ = ผจก.สาขา + แอดมิน (ไม่ใช่พนักงานเก็บของ) */
function canWriteOff(role: Parameters<typeof isCfAdmin>[0]): boolean {
  return isCfAdmin(role) || isCfBranchManager(role);
}

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

export async function submitStockCount(input: unknown): Promise<Result<{ countCode: string | null; countId: string | null; adjusted: number; skipped: number; anomaly: boolean; status: "APPLIED" | "PENDING" }>> {
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

  // D1 · role-rank guard — ปรับยอดนับกายภาพ = ปรับสต๊อกได้ตรง ๆ (ซ่อน shrinkage ได้ถ้าปรับยอดลง)
  // → เฉพาะผู้จัดการสาขา/แอดมินเท่านั้น (พนักงานเก็บของ/viewer นับได้แต่ไม่มีสิทธิ์ "ยืนยันปรับยอด").
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่ยืนยันปรับยอดนับสต๊อกได้");
  }

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
        return { countId: null as string | null, countCode: null as string | null, adjusted: 0, skipped, anomaly: false, status: "APPLIED" as const };
      }

      const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);

      // Wave 4b · มูลค่าปรับ (สตางค์) = Σ |ผลต่าง × ต้นทุนเฉลี่ยปัจจุบัน| ต่อรายการ (นับทั้งขึ้นและลง)
      // เกินเกณฑ์ → PENDING (รอคนที่ 2) · ต่ำกว่าเกณฑ์ → APPLIED (เขียน movement ทันที · พฤติกรรมเดิม)
      const adjustValueCents = diffs.reduce((s, d) => s + Math.abs(d.diff * d.cost), 0);
      const status: "APPLIED" | "PENDING" =
        adjustValueCents > STOCKCOUNT_APPROVAL_CENTS ? "PENDING" : "APPLIED";

      const count = await tx.cfStockCount.create({
        data: {
          orgId,
          branchId,
          countCode: newCountCode(),
          note: note || null,
          itemsCounted: diffs.length,
          totalDiff,
          status,
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

      // เขียน movement ปรับสต๊อก "เฉพาะ" ใบที่ APPLIED (ต่ำกว่าเกณฑ์) เท่านั้น.
      // PENDING → ข้าม · ให้ reviewCfStockCount เขียน movement ตอนอนุมัติ (single source of truth
      // → สต๊อกยังไม่ขยับจนกว่าคนที่ 2 อนุมัติ · กันซ่อน shrinkage ก่อนมีคนตรวจ).
      if (status === "APPLIED") {
        await applyStockCountMovements(tx, {
          orgId, branchId, countId: count.id, createdById: session.user.id,
          diffs: diffs.map((d) => ({ id: d.id, before: d.before, after: d.after, diff: d.diff, reason: d.reason })),
        });
      }

      // R7 · audit trail — ใครสร้างใบนับ + มูลค่าปรับ/สถานะ (maker) ในทรานแซกชันเดียวกัน
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_STOCK_COUNT_CREATE",
          resourceType: "CF_STOCK_COUNT",
          resourceId: count.id,
          diff: {
            new: {
              countCode: count.countCode,
              branchId,
              itemsCounted: diffs.length,
              totalDiff,
              adjustValueCents,
              status,
            },
          },
        },
      });

      // นับต่างมาก → สร้าง sentinel anomaly session (เด้งเข้าหน้า Anomaly ที่มีอยู่แล้ว)
      // สร้างได้ทั้ง APPLIED และ PENDING — anomaly = "ควรมีคนดู" ไม่ผูกกับการตัดสต๊อกจริง.
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

      return { countId: count.id, countCode: count.countCode, adjusted: diffs.length, skipped, anomaly, status };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath(ANOMALY_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: result };
}

/**
 * เขียน COUNT_ADJUST movement (ปรับยอดสต๊อกตามการนับ · signed delta) ต่อสินค้าในใบนับ.
 * ใช้ร่วมกันระหว่าง submitStockCount (auto-APPLIED ต่ำกว่าเกณฑ์) และ reviewCfStockCount (อนุมัติใบ PENDING)
 * → ให้ ledger เขียนที่เดียว (idempotent guard อยู่ที่ caller: APPLIED/APPROVED status · atomic claim).
 * mirror applyLossMovements.
 */
async function applyStockCountMovements(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    orgId: string;
    branchId: string;
    countId: string;
    createdById: string;
    diffs: Array<{ id: string; before: number; after: number; diff: number; reason: string }>;
  },
): Promise<void> {
  const now = new Date();
  for (const d of args.diffs) {
    await tx.cfStockMovement.create({
      data: {
        orgId: args.orgId,
        branchId: args.branchId,
        type: "COUNT_ADJUST",
        productId: d.id,
        qty: d.diff, // signed delta (+/-)
        expectedQty: d.before,
        varianceQty: d.diff,
        occurredAt: now,
        createdById: args.createdById,
        refTable: "cf_stock_counts",
        refId: args.countId,
        documentType: "stock_count",
        documentId: args.countId,
        reason: d.reason || `นับต่าง · ${d.before}→${d.after}`,
      },
    });
  }
}

// =============================================================
// 2b) อนุมัติ / ตีกลับ ใบนับสต๊อกปรับยอดมูลค่าสูง (maker-checker · Wave 4b)
//     mirror reviewCfLoss เป๊ะ:
//     - เฉพาะผู้จัดการสาขา/แอดมิน · self-approve guard (คนนับ ≠ คนอนุมัติ)
//     - approve → เขียน COUNT_ADJUST movement ตอนนี้ (สต๊อกขยับจริง "เมื่ออนุมัติ")
//     - reject → ไม่เขียน movement (ใบไม่เคยปรับสต๊อก · void) · stamp reviewer
// =============================================================
const ReviewCountSchema = z.object({
  countId: z.string().uuid("ใบนับสต๊อกไม่ถูกต้อง"),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function reviewCfStockCount(input: unknown): Promise<Result<{ countId: string; status: "APPROVED" | "REJECTED" }>> {
  const parsed = ReviewCountSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { countId, decision, note } = parsed.data;

  // หา branch ของใบก่อน เพื่อ assert สิทธิ์ตามสาขา (admin = ทุกสาขา)
  const head = await prisma.cfStockCount.findFirst({
    where: { id: countId },
    select: { id: true, orgId: true, branchId: true, status: true, countedById: true },
  });
  if (!head) return err("ไม่พบใบนับสต๊อก");

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(head.branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;
  if (head.orgId !== orgId) return err("ไม่มีสิทธิ์เข้าถึงใบนับสต๊อกนี้");

  // role-rank guard — เฉพาะผู้จัดการสาขา/แอดมิน (mirror reviewCfLoss)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่อนุมัติ/ตีกลับใบนับสต๊อกได้");
  }

  // self-approve guard (segregation of duties) — คนนับ ≠ คนอนุมัติ (maker ≠ checker)
  if (head.countedById === session.user.id) {
    return err("อนุมัติ/ตีกลับใบที่ตัวเองนับไม่ได้ · ให้คนอื่นตรวจ (maker ≠ checker)");
  }

  // ต้องเป็นใบ PENDING เท่านั้น — ตัดสินไปแล้ว (APPROVED/REJECTED/APPLIED) ห้ามตัดสินซ้ำ
  if (head.status !== "PENDING") {
    return err(
      head.status === "APPROVED" || head.status === "APPLIED"
        ? "ใบนี้ปรับยอดไปแล้ว"
        : "ใบนี้ถูกตีกลับไปแล้ว",
    );
  }

  const newStatus: "APPROVED" | "REJECTED" = decision === "approve" ? "APPROVED" : "REJECTED";

  const result = await prisma
    .$transaction(async (tx) => {
      // 🔒 atomic claim — อนุมัติได้ครั้งเดียว: อัปเดตเฉพาะแถวที่ยัง PENDING.
      // 2 คนกดอนุมัติพร้อมกัน → คนที่สอง match 0 แถว → no-op (ไม่เขียน movement ซ้ำ = ปรับสต๊อกซ้ำ)
      const claim = await tx.cfStockCount.updateMany({
        where: { id: head.id, orgId, status: "PENDING" },
        data: {
          status: newStatus,
          reviewedById: session.user.id,
          reviewedByName: session.user.name || session.user.email || null,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
      if (claim.count !== 1) {
        // คนอื่นตัดสินไปก่อนแล้ว (race) → no-op
        throw new Error("ใบนี้เพิ่งถูกตัดสินไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // approve → เขียน movement ปรับสต๊อก "ตอนนี้" (สต๊อกขยับจริงเมื่ออนุมัติ)
      // reject → ไม่เขียนอะไร (ใบ PENDING ไม่เคยปรับสต๊อก → void สะอาด · ไม่ต้องกลับรายการ)
      if (newStatus === "APPROVED") {
        // ⚠️ ใช้ยอดระบบ ณ ตอนอนุมัติ (before ปัจจุบัน) เป็นฐานปรับ — ไม่ใช่ systemQty ที่บันทึกตอนนับ.
        // ถ้ามี movement อื่นแทรกระหว่างรออนุมัติ (รับเข้า/โอน) systemQty เก่าจะ stale → ปรับด้วย delta เก่า
        // จะทำยอดเพี้ยน. เป้าหมายคือ "ทำให้ยอดระบบ = ยอดที่นับได้ (countedQty)" → delta = countedQty − beforeNow.
        const lines = await tx.cfStockCountLine.findMany({
          where: { countId: head.id, orgId },
          select: { productId: true, countedQty: true, reason: true },
        });
        const diffs: Array<{ id: string; before: number; after: number; diff: number; reason: string }> = [];
        for (const l of lines) {
          const before = await currentBalance(tx, orgId, head.branchId, l.productId);
          if (l.countedQty === before) continue; // ยอดตรงแล้ว (ปรับไปแล้วทางอื่น) → ข้าม
          diffs.push({
            id: l.productId,
            before,
            after: l.countedQty,
            diff: l.countedQty - before,
            reason: l.reason ?? "",
          });
        }
        if (diffs.length > 0) {
          await applyStockCountMovements(tx, {
            orgId,
            branchId: head.branchId,
            countId: head.id,
            createdById: session.user.id,
            diffs,
          });
        }
      }

      // R7 · audit trail — ใครอนุมัติ/ตีกลับ (checker) + จากสถานะไหนไปไหน ในทรานแซกชันเดียวกัน
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_STOCK_COUNT_REVIEW",
          resourceType: "CF_STOCK_COUNT",
          resourceId: head.id,
          diff: {
            old: { status: "PENDING" },
            new: { status: newStatus, reviewNote: note || null, countedById: head.countedById, decision },
          },
        },
      });

      return { status: newStatus };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath(ANOMALY_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: { countId, status: result.status } };
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

export async function recordLoss(input: unknown): Promise<Result<{ lossCode: string; lossId: string; totalCostCents: number; status: "PENDING" | "APPROVED" }>> {
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

  // D1 · role-rank guard — เฉพาะผู้จัดการสาขา/แอดมินเท่านั้นที่สร้างใบตัดของเสียได้
  // (พนักงานเก็บของ/viewer ตัดของออกจากคลังเองไม่ได้ · กันตัด/ซ่อนของหายลำพัง)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่ตัดของเสีย/ของหายได้");
  }

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

      // D1 · มูลค่าเกินเกณฑ์ → PENDING (รอคนที่ 2 อนุมัติ) · ต่ำกว่าเกณฑ์ → APPROVED อัตโนมัติ
      // ⚠️ Ledger correctness: PENDING = ยังไม่ตัดสต๊อกจริง (ไม่เขียน LOSS_ADJUST movement)
      //    → สต๊อกยังไม่ลดจนกว่าจะ APPROVED (กันซ่อน shrinkage ก่อนมีคนตรวจ).
      const status: "PENDING" | "APPROVED" =
        total > LOSS_APPROVAL_THRESHOLD_CENTS ? "PENDING" : "APPROVED";

      const loss = await tx.cfLossDoc.create({
        data: {
          orgId,
          branchId,
          lossCode: newLossCode(),
          reason,
          note: note || null,
          totalCostCents: total,
          status,
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

      // เขียน movement ตัดสต๊อก "เฉพาะ" ใบที่ APPROVED (auto ต่ำกว่าเกณฑ์) เท่านั้น.
      // PENDING → ข้าม · ให้ reviewCfLoss เขียน movement ตอนอนุมัติ (single source of truth).
      if (status === "APPROVED") {
        await applyLossMovements(tx, {
          orgId, branchId, lossId: loss.id, reason,
          createdById: session.user.id, photoUrls: photoUrls ?? [],
          work,
        });
      }

      // R7 (audit 2026-07) · audit trail — บันทึกใครสร้างใบตัดของเสีย + มูลค่า/สถานะ (maker)
      // ในทรานแซกชันเดียวกัน → ถ้าใบ rollback log ก็ rollback ตาม (ไม่มี log กำพร้า)
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_LOSS_CREATE",
          resourceType: "CF_LOSS_DOC",
          resourceId: loss.id,
          diff: {
            new: {
              lossCode: loss.lossCode,
              branchId,
              reason,
              totalCostCents: total,
              status,
              lines: work.map((w) => ({ productId: w.id, qty: w.qty, unitCostCents: w.cost })),
            },
          },
        },
      });

      return { lossId: loss.id, lossCode: loss.lossCode, totalCostCents: total, status };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: result };
}

/**
 * เขียน LOSS_ADJUST movement (ตัดสต๊อกออก · negative qty) ต่อสินค้าในใบตัดของเสีย.
 * ใช้ร่วมกันระหว่าง recordLoss (auto-APPROVED) และ reviewCfLoss (อนุมัติใบ PENDING)
 * → ให้ ledger เขียนที่เดียว (idempotent guard อยู่ที่ caller: PENDING/APPROVED status).
 */
async function applyLossMovements(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    orgId: string;
    branchId: string;
    lossId: string;
    reason: string;
    createdById: string;
    photoUrls: string[];
    work: Array<{ id: string; qty: number; cost: number; note: string }>;
  },
): Promise<void> {
  const now = new Date();
  for (const w of args.work) {
    await tx.cfStockMovement.create({
      data: {
        orgId: args.orgId,
        branchId: args.branchId,
        type: "LOSS_ADJUST",
        productId: w.id,
        qty: -w.qty, // negative — ของหายออกจากคลัง
        unitCostCents: w.cost,
        occurredAt: now,
        createdById: args.createdById,
        refTable: "cf_loss_docs",
        refId: args.lossId,
        documentType: "loss_doc",
        documentId: args.lossId,
        photoUrls: args.photoUrls,
        reason: w.note || `ของหาย/เสียหาย (${args.reason})`,
      },
    });
  }
}

// =============================================================
// 3b) อนุมัติ / ตีกลับ ใบตัดของเสีย (maker-checker · D1 audit 2026-07-01)
//     - เฉพาะผู้จัดการสาขา/แอดมิน · self-approve guard (คนแจ้ง ≠ คนอนุมัติ)
//     - approve → เขียน LOSS_ADJUST movement ตอนนี้ (สต๊อกลดจริง "เมื่ออนุมัติ")
//     - reject → ไม่เขียน movement (ใบไม่เคยตัดสต๊อก · void) · stamp reviewer
// =============================================================
const ReviewLossSchema = z.object({
  lossId: z.string().uuid("ใบตัดของเสียไม่ถูกต้อง"),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export async function reviewCfLoss(input: unknown): Promise<Result<{ lossId: string; status: "APPROVED" | "REJECTED" }>> {
  const parsed = ReviewLossSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
  const { lossId, decision, note } = parsed.data;

  // หา branch ของใบก่อน เพื่อ assert สิทธิ์ตามสาขา (admin = ทุกสาขา)
  const head = await prisma.cfLossDoc.findFirst({
    where: { id: lossId },
    select: { id: true, orgId: true, branchId: true, status: true, reason: true, reportedById: true, photoUrls: true },
  });
  if (!head) return err("ไม่พบใบตัดของเสีย");

  let ctx: { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };
  try {
    ctx = await assertBranchAccess(head.branchId);
  } catch (e) {
    return err((e as Error).message);
  }
  const { session, orgId } = ctx;
  if (head.orgId !== orgId) return err("ไม่มีสิทธิ์เข้าถึงใบตัดของเสียนี้");

  // role-rank guard — เฉพาะผู้จัดการสาขา/แอดมิน (mirror reviewV2Session A1)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่อนุมัติ/ตีกลับใบตัดของเสียได้");
  }

  // self-approve guard (segregation of duties · F2) — คนแจ้ง ≠ คนอนุมัติ
  if (head.reportedById === session.user.id) {
    return err("อนุมัติ/ตีกลับใบที่ตัวเองแจ้งไม่ได้ · ให้คนอื่นตรวจ (maker ≠ checker)");
  }

  // ต้องเป็นใบ PENDING เท่านั้น — ตัดสินไปแล้ว (APPROVED/REJECTED) ห้ามตัดสินซ้ำ
  if (head.status !== "PENDING") {
    return err(
      head.status === "APPROVED" ? "ใบนี้อนุมัติไปแล้ว" : "ใบนี้ถูกตีกลับไปแล้ว",
    );
  }

  const newStatus: "APPROVED" | "REJECTED" = decision === "approve" ? "APPROVED" : "REJECTED";

  const result = await prisma
    .$transaction(async (tx) => {
      // 🔒 atomic claim — อนุมัติได้ครั้งเดียว: อัปเดตเฉพาะแถวที่ยัง PENDING.
      // 2 คนกดอนุมัติพร้อมกัน → คนที่สอง match 0 แถว → no-op (ไม่เขียน movement ซ้ำ = ตัดสต๊อกซ้ำ)
      const claim = await tx.cfLossDoc.updateMany({
        where: { id: head.id, orgId, status: "PENDING" },
        data: {
          status: newStatus,
          reviewedById: session.user.id,
          reviewedByName: session.user.name || session.user.email || null,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
      if (claim.count !== 1) {
        // คนอื่นตัดสินไปก่อนแล้ว (race) → no-op
        throw new Error("ใบนี้เพิ่งถูกตัดสินไปแล้ว · รีเฟรชแล้วลองใหม่");
      }

      // approve → เขียน movement ตัดสต๊อก "ตอนนี้" (สต๊อกลดจริงเมื่ออนุมัติ)
      // reject → ไม่เขียนอะไร (ใบ PENDING ไม่เคยตัดสต๊อก → void สะอาด · ไม่ต้องกลับรายการ)
      if (newStatus === "APPROVED") {
        const lines = await tx.cfLossLine.findMany({
          where: { lossId: head.id, orgId },
          select: { productId: true, qty: true, unitCostCents: true, note: true },
        });
        await applyLossMovements(tx, {
          orgId,
          branchId: head.branchId,
          lossId: head.id,
          reason: head.reason,
          createdById: session.user.id,
          photoUrls: head.photoUrls ?? [],
          work: lines.map((l) => ({ id: l.productId, qty: l.qty, cost: l.unitCostCents, note: l.note ?? "" })),
        });
      }

      // R7 (audit 2026-07) · audit trail — บันทึกใครอนุมัติ/ตีกลับ (checker) + จากสถานะไหนไปไหน
      // ในทรานแซกชันเดียวกัน → ผูกกับ claim ที่สำเร็จ (ถ้า rollback log หายตาม)
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: decision === "approve" ? "CF_LOSS_APPROVE" : "CF_LOSS_REJECT",
          resourceType: "CF_LOSS_DOC",
          resourceId: head.id,
          diff: {
            old: { status: "PENDING" },
            new: { status: newStatus, reviewNote: note || null, reportedById: head.reportedById },
          },
        },
      });

      return { status: newStatus };
    })
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in result) return err(result.error);
  revalidatePath(STOCK_PATH);
  revalidatePath("/clawfleet/os/dashboard");
  return { ok: true, data: { lossId, status: result.status } };
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

  // role-rank guard (audit 2026-07 ultrareview) — โอนสต๊อก = ตัด/ย้ายสต๊อกจริง
  // → เฉพาะผู้จัดการสาขา/แอดมิน (viewer/staff ห้ามเขียนสต๊อก · mirror recordLoss)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่โอนสต๊อกระหว่างสาขาได้");
  }

  const product = await prisma.cfProduct.findFirst({
    where: { id: productId, orgId },
    select: { id: true, name: true, unitCostCents: true },
  });
  if (!product) return err("ไม่พบสินค้า");

  const transferCode = newTransferCode();
  const result = await prisma
    .$transaction(async (tx) => {
      // 🔒 ล็อกต่อ product (transaction-level · hashtext เดียวกับ receiveStock) — serialize
      // การอ่าน balance→เขียน movement กัน 2 การโอน/เบิกสินค้าตัวเดียวกันพร้อมกัน อ่าน balance
      // ก้อนเดียวกันแล้วเขียนออกทั้งคู่ → สต๊อกติดลบ (each thought there was enough).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${productId}))`;
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

  // role-rank guard (audit 2026-07 ultrareview) — เบิก/ตัดจ่าย = ตัดสต๊อกออกจริง
  // → เฉพาะผู้จัดการสาขา/แอดมิน (viewer/staff ห้ามเขียนสต๊อก · mirror recordLoss)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่เบิก/ตัดจ่ายสต๊อกได้");
  }

  const product = await prisma.cfProduct.findFirst({
    where: { id: productId, orgId }, select: { id: true, unitCostCents: true },
  });
  if (!product) return err("ไม่พบสินค้า");

  const result = await prisma
    .$transaction(async (tx) => {
      // 🔒 ล็อกต่อ product (transaction-level · hashtext เดียวกับ receiveStock) — serialize
      // อ่าน balance→เขียน movement กัน 2 การเบิกสินค้าตัวเดียวกันพร้อมกันทำสต๊อกติดลบ.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${productId}))`;
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
        // แอดมินส่วนกลางส่งของ = ต้องระบุราคาขาย + ราคาทุนของสินค้า ณ ตอนส่ง (บังคับ > 0)
        salePriceBaht: z.coerce.number().int().positive("ระบุราคาขายของสินค้า (บาท) มากกว่า 0"),
        unitCostCents: z.coerce.number().int().positive("ระบุราคาทุนของสินค้า (บาท) มากกว่า 0"),
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

  // role-rank guard (audit 2026-07 ultrareview) — สร้างใบกระจาย = เอกสารเคลื่อนสต๊อกคลังกลาง
  // → เฉพาะผู้จัดการสาขา/แอดมิน (viewer/staff ห้ามสร้าง · mirror recordLoss)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่สร้างใบกระจายสินค้าได้");
  }

  const result = await prisma
    .$transaction(async (tx) => {
      const ids = lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true },
      });
      const pmap = new Map(products.map((p) => [p.id, p]));

      // รวม qty ของ product ที่ซ้ำบรรทัด → 1 line ต่อ product (กันใบกระจายมีสินค้าซ้ำ)
      // ราคาขาย/ราคาทุน = ใช้ค่าจากบรรทัดล่าสุดของ product นั้น (บังคับ > 0 มาแล้วจาก Zod)
      const agg = new Map<
        string,
        { id: string; name: string; qty: number; salePriceBaht: number; unitCostCents: number }
      >();
      for (const l of lines) {
        const p = pmap.get(l.productId);
        if (!p) throw new Error(`ไม่พบสินค้า ${l.productId}`);
        const cur = agg.get(p.id);
        if (cur) {
          cur.qty += l.qty;
          cur.salePriceBaht = l.salePriceBaht;
          cur.unitCostCents = l.unitCostCents;
        } else {
          agg.set(p.id, {
            id: p.id,
            name: p.name,
            qty: l.qty,
            salePriceBaht: l.salePriceBaht,
            unitCostCents: l.unitCostCents,
          });
        }
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
              salePriceBaht: w.salePriceBaht,
              unitCostCents: w.unitCostCents,
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

  // role-rank guard (audit 2026-07 ultrareview) — ตรวจรับ = รับของเข้าสต๊อก + ตั้งต้นทุน/ราคาขาย
  // → เฉพาะผู้จัดการสาขา/แอดมิน (viewer/staff ห้ามยืนยัน · mirror recordLoss)
  if (!canWriteOff(session.user.role)) {
    return err("เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่ยืนยันตรวจรับใบกระจายได้");
  }

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
          lines: {
            select: {
              id: true,
              productId: true,
              productName: true,
              qty: true,
              salePriceBaht: true,
              unitCostCents: true,
            },
          },
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

      // ต้นทุนต่อชิ้น = ราคาทุนที่แอดมินส่วนกลางระบุบนใบกระจาย (line.unitCostCents · บังคับ > 0 ตอนสร้างใบ)
      // แถวเก่า (ก่อน migration wave B) จะมี unitCostCents = 0 → fallback ต้นทุนเฉลี่ยปัจจุบันของสินค้า
      // เพื่อไม่ให้ใบเก่ายืนยันรับไม่ได้ · ห้าม 0 สุดท้าย (เจือจางต้นทุนเฉลี่ยถ่วงน้ำหนัก)
      const ids = d.lines.map((l) => l.productId);
      const products = await tx.cfProduct.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, unitCostCents: true },
      });
      const prodCostMap = new Map(products.map((p) => [p.id, p.unitCostCents]));
      const nameMap = new Map(products.map((p) => [p.id, p.name]));

      // รวมจำนวนรับจริงต่อ product (กัน product ซ้ำหลาย line) + รวมมูลค่าทุนเพื่อหาต้นทุนเฉลี่ยของครั้งนี้
      // + carry ราคาขาย (บาท) ที่ระบุบนใบ → ตั้งเป็น defaultPriceCoins ของสินค้า
      const agg = new Map<
        string,
        { id: string; qty: number; costTotalCents: number; salePriceBaht: number | null }
      >();
      for (const ln of d.lines) {
        const recv = recvMap.get(ln.id);
        // clamp ≤ qty ในใบ (รับเกินจำนวนที่ส่งไม่ได้) · ไม่ส่งจำนวนมา = รับครบตามใบ
        const qty = recv == null ? ln.qty : Math.min(recv, ln.qty);
        await tx.cfDeliveryLine.update({ where: { id: ln.id }, data: { receivedQty: qty } });
        if (qty <= 0) continue;
        // ต้นทุนจากใบก่อน · ถ้าใบเก่าไม่มี (0) → ต้นทุนเฉลี่ยปัจจุบันของสินค้า
        const lineCost = ln.unitCostCents > 0 ? ln.unitCostCents : (prodCostMap.get(ln.productId) ?? 0);
        if (lineCost <= 0) {
          // reject ทั้งใบ (rollback claim) แทนเขียน movement ทุน 0 ที่ทำต้นทุนเฉลี่ยเพี้ยน
          throw new Error(
            `สินค้า "${nameMap.get(ln.productId) ?? ln.productName}" ยังไม่ได้ตั้งราคาทุน · ตั้งราคาทุนก่อนรับเข้าคลัง`,
          );
        }
        const cur = agg.get(ln.productId);
        if (cur) {
          cur.qty += qty;
          cur.costTotalCents += lineCost * qty;
          if (ln.salePriceBaht != null && ln.salePriceBaht > 0) cur.salePriceBaht = ln.salePriceBaht;
        } else {
          agg.set(ln.productId, {
            id: ln.productId,
            qty,
            costTotalCents: lineCost * qty,
            salePriceBaht: ln.salePriceBaht != null && ln.salePriceBaht > 0 ? ln.salePriceBaht : null,
          });
        }
      }

      // รับเข้าสต๊อกสาขา — RECEIPT_IN movement (machineId null = คลังสาขา) · ตรรกะเดียวกับ receiveStock:
      // (1) ล็อกต่อ product กัน lost-update ต้นทุนเฉลี่ยถ่วงน้ำหนัก
      // (2) อัปเดต cfProduct.unitCostCents = ต้นทุนเฉลี่ยถ่วงน้ำหนัก (org-wide)
      // (3) ตั้ง defaultPriceCoins จากราคาขายบนใบ (baht → เหรียญ · 10 บาท = 1 เหรียญ · อย่างน้อย 1)
      const now = new Date();
      for (const a of agg.values()) {
        // 🔒 ล็อกต่อ product (transaction-level) — serialize การคำนวณต้นทุนเฉลี่ยถ่วงน้ำหนัก
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.id}))`;
        const unit = a.qty > 0 ? Math.round(a.costTotalCents / a.qty) : 0;
        const oldCost = prodCostMap.get(a.id) ?? 0;
        const totalQtyAcrossOrg = await tx.cfStockMovement.aggregate({
          where: { orgId, productId: a.id },
          _sum: { qty: true },
        });
        const orgQtyBefore = Math.max(0, totalQtyAcrossOrg._sum.qty ?? 0);
        const avgCost =
          orgQtyBefore + a.qty > 0
            ? Math.round((oldCost * orgQtyBefore + unit * a.qty) / (orgQtyBefore + a.qty))
            : unit;

        // อัปเดตต้นทุนเฉลี่ย + (ถ้ามีราคาขายบนใบ) ตั้งราคาขายเริ่มต้นของสินค้า
        const productUpdate: { unitCostCents: number; defaultPriceCoins?: number } = {
          unitCostCents: avgCost,
        };
        if (a.salePriceBaht != null && a.salePriceBaht > 0) {
          productUpdate.defaultPriceCoins = Math.max(1, Math.round(a.salePriceBaht / 10));
        }
        await tx.cfProduct.update({ where: { id: a.id }, data: productUpdate });

        const oldBal = await currentBalance(tx, orgId, d.branchId, a.id);
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: d.branchId,
            type: "RECEIPT_IN",
            productId: a.id,
            qty: a.qty,
            unitCostCents: unit,
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
