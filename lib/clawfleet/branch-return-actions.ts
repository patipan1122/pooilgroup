"use server";

// ClawFleet · ส่งคืนคลังกลาง (DC) — การคืนของ 2 สเต็ป (mirror money-safety ของ stock-actions + dc/stock)
//   สเต็ป 1 · createBranchReturn — สาขา "ส่งคืน" → ตัดสต๊อกสาขาทันที (TRANSFER_OUT) + สร้างใบ PENDING
//   สเต็ป 2 · confirmBranchReturn — คน DC "รับคืน" → ลงสต๊อกคลัง DC (RETURN_IN) + ปิดใบ CONFIRMED
//   ยกเลิก  · cancelBranchReturn  — คืนสต๊อกสาขา (compensating TRANSFER_IN) เฉพาะใบที่ยัง PENDING
//   DC list · listPendingBranchReturnsForDc — รายการรอ DC รับคืน (scoped ตามคลังที่มีสิทธิ์)
//
// ★ INVARIANTS (money-critical):
//   • idempotency สาขา = CfBranchReturn.clientKey (@@unique[orgId,clientKey]) · retry/กดซ้ำ = ใบเดิม ไม่ตัดซ้ำ
//   • idempotency DC = recordMovement.sourceKey (@@unique[orgId,sourceKey]) · รับคืนซ้ำ = ไม่ลงสต๊อกซ้ำ
//   • over-issue guard = currentNetShelf (NET ทั้งสาขา · ไม่ให้คืนตุ๊กตาที่โหลดเข้าตู้ไปแล้ว) mirror transferStock
//   • ต้นทุน 1:1 satang↔cents (ไม่สเกล) เหมือน receiveDcTransferIntoBranchTx
//   • confirm 3 สเต็ป: (1) atomic claim PENDING→RECEIVING (ปิด race กับ cancel ที่ยกเลิกได้เฉพาะ PENDING)
//     (2) ลงสต๊อก DC (recordMovement เปิด tx เอง · idempotent ผ่าน sourceKey) (3) final flip RECEIVING→CONFIRMED
//     ⇒ crash กลางทาง = ใบค้าง RECEIVING (retry/resume ได้ · ลงของซ้ำไม่ได้) · ไม่มีทาง CONFIRMED-แต่-ไม่มีของ
//     ⇒ ทันที claim เป็น RECEIVING แล้ว cancel ยิงไม่ได้อีก → ของไม่มีทางโผล่ 2 ฝั่ง (สาขาคืน + DC รับ)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isCfAdmin, isCfBranchManager, userBranchIds } from "./role-guard";
import { getBranchMainWarehouseId } from "./stock-queries";
import { assertClawfleetBranchInOrg, CLAWFLEET_MODULE } from "@/lib/dc/product-link";
import { recordMovement } from "@/lib/dc/stock";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import { canDcFloor } from "@/lib/dc/role-guard";
import { assertWarehouseAllowed, getAllowedWarehouses } from "@/lib/dc/access";

const RETURN_PATH = "/clawfleet/os/stock";

// client ของ transaction (prisma ก็ assignable เพราะ structural — ใช้ในทั้ง tx และ read ตรง) ─────────────
type CfDb = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ── helpers (มิเรอร์ stock-actions.ts · ปลอดภัยที่จะ duplicate เพราะเป็น read-formula/ข้อความล้วน) ──────

/**
 * "ของบนชั้นจริง" (NET) ทั้งสาขา = Σ ทุกแถวของสินค้าในสาขา (รับเข้า − โหลดเข้าตู้ − เบิก + คืน).
 * mirror currentNetShelf ใน stock-actions.ts (ไม่กรอง warehouse = ทั้งสาขา · เหมือน transferStock ใช้ตอนโอน).
 * ใช้เป็น over-issue guard ตอนส่งคืน — กันคืนเกินของบนชั้น (gross จะยอมให้เกิน → net ติดลบ).
 */
async function currentNetShelf(db: CfDb, orgId: string, branchId: string, productId: string): Promise<number> {
  const agg = await db.cfStockMovement.aggregate({
    where: { orgId, branchId, productId },
    _sum: { qty: true },
  });
  return agg._sum.qty ?? 0;
}

/** duck-typed Prisma unique-violation → normalize meta.target เป็น string เดียว (lowercase) เพื่อเช็ค constraint ที่ชน */
function p2002Target(e: unknown): string | null {
  if (typeof e !== "object" || e === null || (e as { code?: string }).code !== "P2002") return null;
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.join(",").toLowerCase() : String(target ?? "").toLowerCase();
}

/** error จาก tx → ข้อความที่คนอ่านได้ (guard เราโยน Error ไทยอยู่แล้ว · error ระบบภาษาอังกฤษ log ไว้แล้วคืนกลาง ๆ) */
function txErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/[฀-๿]/.test(msg)) return msg; // มีอักษรไทย = ข้อความ guard ที่ตั้งใจโชว์
  console.error("[cf branch-return tx]", msg);
  return "บันทึกไม่สำเร็จ · ระบบขัดข้อง ลองใหม่อีกครั้ง (ถ้าซ้ำแจ้งแอดมิน)";
}

// ── code-gen (RET-YYMMDD-XXXX · BE year 2 หลัก · random suffix · กันชนด้วย @@unique[orgId,returnCode] + retry) ──
function newReturnCode(): string {
  const d = new Date();
  const yy = String(d.getFullYear() + 543).slice(-2); // ปี พ.ศ. 2 หลัก (mirror beYearTwo ใน stock-actions)
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `RET-${yy}${mm}${dd}-${rnd}`;
}

/**
 * cfProductId → dcProductId (reverse ของ resolveClawfleetProduct). null = จับคู่ไม่ได้.
 *   (a) DcProductLink (deterministic · orderBy id asc = ตัวเก่าสุด กัน race หลายแถว)
 *   (b) fallback barcode เท่านั้น (แม่นยำ · unique ต่อ org) — ห้าม match ด้วย sku (mis-attribution เงิน)
 */
async function resolveDcProductId(
  orgId: string,
  cfProductId: string,
  cfBarcode: string | null,
): Promise<string | null> {
  const link = await prisma.dcProductLink.findFirst({
    where: { orgId, destProductId: cfProductId, destModule: CLAWFLEET_MODULE },
    orderBy: { id: "asc" },
    select: { productId: true },
  });
  if (link) return link.productId;
  if (cfBarcode) {
    const dc = await prisma.dcProduct.findFirst({
      where: { orgId, barcode: cfBarcode, active: true },
      select: { id: true },
    });
    if (dc) return dc.id;
  }
  return null;
}

// =============================================================
// 1) createBranchReturn — สาขาส่งคืน (ตัดสต๊อกสาขาทันที · ใบ PENDING)
// =============================================================
const CreateReturnSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  clientKey: z.string().trim().min(1, "ไม่มี clientKey").max(200),
  note: z.string().trim().max(500).optional(),
  sourceTransferCode: z.string().trim().max(64).optional(),
  lines: z
    .array(
      z.object({
        cfProductId: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
      }),
    )
    .min(1, "ยังไม่ได้เลือกรายการส่งคืน"),
});

export type CreateBranchReturnResult =
  | { ok: true; returnId: string; returnCode: string; alreadyDone?: boolean }
  | { ok: false; error: string };

export async function createBranchReturn(input: unknown): Promise<CreateBranchReturnResult> {
  const parsed = CreateReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { branchId, clientKey, note, sourceTransferCode } = parsed.data;

  const session = await requireSession();
  const orgId = session.user.org_id;

  // role gate — เหมือน transferStock: เฉพาะ ผจก.สาขา/แอดมิน (viewer/staff เขียนสต๊อกไม่ได้)
  if (!(isCfAdmin(session.user.role) || isCfBranchManager(session.user.role))) {
    return { ok: false, error: "เฉพาะผู้จัดการสาขาหรือแอดมินเท่านั้นที่ส่งคืนคลังกลางได้" };
  }
  // membership — ต้องเป็นสมาชิกสาขานี้ (admin/viewer = ALL) · mirror assertBranchAccess (ไม่ให้ ผจก. คนอื่นสั่งข้ามสาขา)
  const allowed = await userBranchIds(session);
  if (allowed !== "ALL" && !allowed.includes(branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  // สาขาปลายทางเป็นตู้คีบของ org จริง (กัน cross-org / ไม่ใช่ตู้คีบ / ปิดใช้งาน)
  const branchOk = await assertClawfleetBranchInOrg(orgId, branchId);
  if (!branchOk.ok) return { ok: false, error: branchOk.error };

  // dedupe/aggregate by cfProductId (product ซ้ำหลายบรรทัด → รวม qty ก้อนเดียว กัน lock/guard เพี้ยน)
  const qtyByProduct = new Map<string, number>();
  for (const ln of parsed.data.lines) {
    const q = Math.trunc(ln.qty);
    if (!Number.isInteger(q) || q <= 0) return { ok: false, error: "จำนวนต้องเป็นจำนวนเต็มมากกว่า 0" };
    qtyByProduct.set(ln.cfProductId, (qtyByProduct.get(ln.cfProductId) ?? 0) + q);
  }

  // IDEMPOTENCY — เคยสร้างด้วย clientKey นี้แล้ว → คืนใบเดิม (ไม่เขียนซ้ำ)
  const existing = await prisma.cfBranchReturn.findFirst({
    where: { orgId, clientKey },
    select: { id: true, returnCode: true },
  });
  if (existing) return { ok: true, returnId: existing.id, returnCode: existing.returnCode, alreadyDone: true };

  // คลัง DC ปลายทาง = คลัง default ของ org
  const defWh = await prisma.dcWarehouse.findFirst({
    where: { orgId, isDefault: true, isActive: true },
    select: { id: true },
  });
  if (!defWh) return { ok: false, error: "ยังไม่ได้ตั้งคลังกลาง (DC) เริ่มต้น — ให้แอดมินตั้งคลัง default ก่อน" };
  const toWarehouseId = defWh.id;

  // อ่าน catalog (ชื่อ/ต้นทุน/บาร์โค้ด) + ยืนยันทุกสินค้า ∈ org
  const cfProductIds = [...qtyByProduct.keys()];
  const products = await prisma.cfProduct.findMany({
    where: { id: { in: cfProductIds }, orgId },
    select: { id: true, name: true, unitCostCents: true, barcode: true },
  });
  if (products.length !== cfProductIds.length) {
    return { ok: false, error: "มีสินค้าบางรายการไม่พบในองค์กรนี้" };
  }
  const prodMap = new Map(products.map((p) => [p.id, p]));

  // resolve dcProductId ต่อบรรทัด (nullable · confirm re-resolve ได้ถ้ายัง null) — เรียงตาม cfProductId (ลำดับล็อกคงที่)
  const lineData: { cfProductId: string; dcProductId: string | null; productName: string; qty: number; unitCostCents: number }[] = [];
  for (const [cfProductId, qty] of qtyByProduct) {
    const p = prodMap.get(cfProductId);
    if (!p) return { ok: false, error: "มีสินค้าบางรายการไม่พบในองค์กรนี้" };
    const dcProductId = await resolveDcProductId(orgId, cfProductId, p.barcode);
    lineData.push({ cfProductId, dcProductId, productName: p.name, qty, unitCostCents: p.unitCostCents });
  }
  lineData.sort((a, b) => (a.cfProductId < b.cfProductId ? -1 : a.cfProductId > b.cfProductId ? 1 : 0));

  // main warehouse ของสาขา (null = main ตาม INVARIANT) — stamp บน movement (mirror receiveDcTransferIntoBranchTx)
  const mainWarehouseId = await getBranchMainWarehouseId(orgId, branchId);

  // retry เผื่อ returnCode สุ่มชน (@@unique[orgId,returnCode]) — clientKey คือ idempotency หลัก
  for (let attempt = 0; attempt < 4; attempt++) {
    const returnId = randomUUID();
    const returnCode = newReturnCode();
    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        for (const ln of lineData) {
          // 🔒 ล็อกต่อ product (hashtext เดียวกับ transferStock/receive) — serialize อ่าน net-shelf → เขียน TRANSFER_OUT
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ln.cfProductId}))`;
          const onShelf = await currentNetShelf(tx, orgId, branchId, ln.cfProductId);
          if (onShelf < ln.qty) {
            throw new Error(`สต๊อกไม่พอ: ${ln.productName} (เหลือบนชั้น ${onShelf} ต้องการ ${ln.qty})`);
          }
          await tx.cfStockMovement.create({
            data: {
              orgId,
              branchId,
              warehouseId: mainWarehouseId, // null = main ตาม INVARIANT
              machineId: null,
              type: "TRANSFER_OUT",
              productId: ln.cfProductId,
              qty: -ln.qty, // ตัดออกจากสาขา (ลบ)
              unitCostCents: ln.unitCostCents, // snapshot ต้นทุน (1:1 satang↔cents)
              occurredAt: now,
              createdById: session.user.id,
              refTable: "cf_branch_returns",
              refId: returnId,
              documentType: "transfer",
              documentId: returnId,
              reason: `ส่งคืน DC · ${returnCode}`,
            },
          });
        }
        await tx.cfBranchReturn.create({
          data: {
            id: returnId,
            orgId,
            branchId,
            returnCode,
            clientKey,
            toWarehouseId,
            status: "PENDING",
            note: note?.trim() ? note.trim() : null,
            sourceTransferCode: sourceTransferCode?.trim() ? sourceTransferCode.trim() : null,
            dispatchedByUserId: session.user.id,
            lines: {
              create: lineData.map((ln) => ({
                orgId,
                cfProductId: ln.cfProductId,
                dcProductId: ln.dcProductId,
                productName: ln.productName,
                qty: ln.qty,
                unitCostCents: ln.unitCostCents,
              })),
            },
          },
        });
      });
      revalidatePath(RETURN_PATH);
      return { ok: true, returnId, returnCode };
    } catch (e) {
      const tgt = p2002Target(e);
      if (tgt?.includes("client_key")) {
        // มีคนสร้างด้วย clientKey เดียวกันพร้อมกัน → คืนใบนั้น (idempotent · ไม่ตัดสต๊อกซ้ำ เพราะ tx นี้ rollback แล้ว)
        const again = await prisma.cfBranchReturn.findFirst({
          where: { orgId, clientKey },
          select: { id: true, returnCode: true },
        });
        if (again) return { ok: true, returnId: again.id, returnCode: again.returnCode, alreadyDone: true };
      }
      if (tgt?.includes("return_code")) continue; // สุ่มเลขใบชน → สุ่มใหม่แล้วลองใหม่
      return { ok: false, error: txErr(e) };
    }
  }
  return { ok: false, error: "สร้างเลขใบส่งคืนไม่สำเร็จ ลองอีกครั้ง" };
}

// =============================================================
// 2) confirmBranchReturn — คน DC รับคืน (ลงสต๊อก DC ก่อน · แล้วปิดใบ)
// =============================================================
export type ConfirmBranchReturnResult =
  | { ok: true; alreadyDone?: boolean }
  | { ok: false; error: string };

export async function confirmBranchReturn(returnId: string): Promise<ConfirmBranchReturnResult> {
  if (!returnId || typeof returnId !== "string") return { ok: false, error: "ไม่พบใบส่งคืน" };
  const session = await requireSession();
  const orgId = session.user.org_id;

  if (!canDcFloor(session.user.role)) {
    return { ok: false, error: "เฉพาะพนักงานคลัง DC เท่านั้นที่รับคืนได้" };
  }

  const ret = await prisma.cfBranchReturn.findFirst({
    where: { id: returnId, orgId },
    select: {
      id: true,
      status: true,
      returnCode: true,
      toWarehouseId: true,
      lines: {
        select: { id: true, cfProductId: true, dcProductId: true, productName: true, qty: true, unitCostCents: true },
      },
    },
  });
  if (!ret) return { ok: false, error: "ไม่พบใบส่งคืน" };
  if (ret.status === "CONFIRMED") return { ok: true, alreadyDone: true }; // idempotent no-op
  if (ret.status === "CANCELLED") return { ok: false, error: "ใบนี้ถูกยกเลิกแล้ว" };

  // ต้องมีสิทธิ์คลัง DC ปลายทาง (throw → แปลงเป็น error)
  try {
    await assertWarehouseAllowed(session, ret.toWarehouseId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ไม่มีสิทธิ์เข้าถึงคลังนี้" };
  }

  // ── ATOMIC CLAIM PENDING→RECEIVING (ปิด race กับ cancel ให้ขาด) ──────────────────────────
  //   cancel ยกเลิกได้ "เฉพาะ PENDING" → เมื่อ claim สำเร็จ (PENDING→RECEIVING) cancel ยิงไม่ได้อีกเลย
  //   ⇒ ของจะไม่มีทางโผล่ทั้ง 2 ฝั่ง (สาขาคืน + DC รับ). claim ก่อนลงสต๊อก · confirmedBy/At ตั้งที่นี่.
  //   ถ้า doc เป็น RECEIVING อยู่แล้วตอน load = confirm รอบก่อน claim แล้ว crash ระหว่างลงสต๊อก
  //     → resume ได้ทันที (ข้าม claim · recordMovement idempotent ผ่าน sourceKey จึงไม่ลงของซ้ำ).
  if (ret.status === "PENDING") {
    const claimed = await prisma.cfBranchReturn.updateMany({
      where: { id: returnId, orgId, status: "PENDING" },
      data: { status: "RECEIVING", confirmedByUserId: session.user.id, confirmedAt: new Date() },
    });
    if (claimed.count === 0) {
      // มีคนเปลี่ยนสถานะไปก่อน (concurrent) — ตัดสินตามสถานะล่าสุด
      const nowRow = await prisma.cfBranchReturn.findFirst({ where: { id: returnId, orgId }, select: { status: true } });
      if (nowRow?.status === "CANCELLED") return { ok: false, error: "ใบนี้ถูกยกเลิกไปแล้ว" };
      if (nowRow?.status === "CONFIRMED") return { ok: true, alreadyDone: true };
      // RECEIVING → confirm อีกตัว claim ไปแล้ว/ค้างกลางทาง → ปลอดภัยที่จะ resume ต่อ (idempotent)
    }
  }

  // ── MONEY-SAFE: ลงสต๊อก DC ก่อน final flip (recordMovement เปิด tx เอง + idempotent ผ่าน sourceKey) ──
  //   crash กลางทาง = ใบยัง RECEIVING (retry ได้ · ลงของซ้ำไม่ได้) · ไม่มีทาง CONFIRMED-แต่-ไม่มีของ
  //   ถ้าใบยังจับคู่ DC ไม่ได้ (dcProductId null) → resolve ใหม่ · ยังไม่ได้ = โยน error (ไม่สร้างสินค้าเงียบ ๆ)
  for (const ln of ret.lines) {
    let dcProductId = ln.dcProductId;
    if (!dcProductId) {
      const cf = await prisma.cfProduct.findFirst({ where: { id: ln.cfProductId, orgId }, select: { barcode: true } });
      dcProductId = await resolveDcProductId(orgId, ln.cfProductId, cf?.barcode ?? null);
    }
    if (!dcProductId) {
      return { ok: false, error: `จับคู่สินค้า DC ไม่ได้: ${ln.productName} — ให้แอดมินผูกสินค้ากับคลัง DC ก่อน` };
    }
    const res = await recordMovement({
      orgId,
      warehouseId: ret.toWarehouseId,
      productId: dcProductId,
      kind: DcMoveKind.RETURN_IN,
      qty: ln.qty, // เข้าคลัง DC (บวก)
      unitCostSatang: ln.unitCostCents, // 1:1 satang↔cents (snapshot ต้นทุนสาขา)
      sourceKey: `cfret:${returnId}:${ln.id}`, // idempotency ต่อบรรทัด · รับซ้ำ = duplicate no-op
      refType: "cf_branch_return",
      refId: returnId,
      note: `รับคืนจากสาขา · ${ret.returnCode}`,
      actorUserId: session.user.id,
    });
    if (!res.ok) return { ok: false, error: res.error };
  }

  // ── FINAL FLIP RECEIVING→CONFIRMED (atomic · confirmedBy/At ตั้งไว้ตอน claim แล้ว) ──
  //   ปลอดภัยเพราะ recordMovement idempotent → re-run confirm ไม่ลงของซ้ำ แค่ flip สถานะ
  const flipped = await prisma.cfBranchReturn.updateMany({
    where: { id: returnId, orgId, status: "RECEIVING" },
    data: { status: "CONFIRMED" },
  });
  if (flipped.count === 0) {
    const nowRow = await prisma.cfBranchReturn.findFirst({ where: { id: returnId, orgId }, select: { status: true } });
    if (nowRow?.status === "CONFIRMED") return { ok: true, alreadyDone: true }; // อีกคน flip แล้ว (ของไม่ซ้ำ)
    // สถานะไม่ใช่ RECEIVING/CONFIRMED ทั้งที่ลงสต๊อก DC แล้ว → เตือนให้ตรวจสอบ (ไม่ปิดเงียบ)
    return { ok: false, error: "ปิดใบรับคืนไม่สำเร็จ — สต๊อก DC ลงแล้ว โปรดแจ้งผู้ดูแลตรวจสอบ" };
  }
  revalidatePath(RETURN_PATH);
  return { ok: true };
}

// =============================================================
// 3) cancelBranchReturn — ยกเลิกใบ PENDING (คืนสต๊อกสาขา · compensating)
//    ★ ยกเลิกได้เฉพาะ PENDING · ถ้า DC รับคืนแล้ว (มี RETURN_IN) หรือใบ CONFIRMED → ห้าม (กันของซ้ำสองฝั่ง)
// =============================================================
export type CancelBranchReturnResult = { ok: true } | { ok: false; error: string };

export async function cancelBranchReturn(returnId: string): Promise<CancelBranchReturnResult> {
  if (!returnId || typeof returnId !== "string") return { ok: false, error: "ไม่พบใบส่งคืน" };
  const session = await requireSession();
  const orgId = session.user.org_id;

  const ret = await prisma.cfBranchReturn.findFirst({
    where: { id: returnId, orgId },
    select: {
      id: true,
      status: true,
      branchId: true,
      returnCode: true,
      dispatchedByUserId: true,
      lines: { select: { cfProductId: true, productName: true, qty: true, unitCostCents: true } },
    },
  });
  if (!ret) return { ok: false, error: "ไม่พบใบส่งคืน" };
  if (ret.status === "CANCELLED") return { ok: true }; // idempotent no-op
  if (ret.status === "CONFIRMED") return { ok: false, error: "ใบนี้ถูกรับคืนที่ DC แล้ว ยกเลิกไม่ได้" };

  // สิทธิ์: ผู้สร้างใบ หรือ แอดมิน ClawFleet
  if (!isCfAdmin(session.user.role) && ret.dispatchedByUserId !== session.user.id) {
    return { ok: false, error: "เฉพาะผู้สร้างใบหรือแอดมินเท่านั้นที่ยกเลิกได้" };
  }

  // กัน race กับ confirm: ถ้า DC ลง RETURN_IN ไปแล้ว → ห้ามยกเลิก (ไม่งั้นของโผล่ทั้งสาขาและ DC)
  const dcPosted = await prisma.dcStockMovement.findFirst({
    where: { orgId, refType: "cf_branch_return", refId: returnId },
    select: { id: true },
  });
  if (dcPosted) return { ok: false, error: "ใบนี้ถูกรับคืนที่ DC แล้ว ยกเลิกไม่ได้" };

  const mainWarehouseId = await getBranchMainWarehouseId(orgId, ret.branchId);
  const sorted = [...ret.lines].sort((a, b) => (a.cfProductId < b.cfProductId ? -1 : a.cfProductId > b.cfProductId ? 1 : 0));
  const STATUS_CHANGED = "__STATUS_CHANGED__";

  try {
    await prisma.$transaction(async (tx) => {
      // atomic claim PENDING→CANCELLED (ยกเลิก + คืนสต๊อก อยู่ tx เดียว = idempotent ผ่าน claim ตัวนี้ตัวเดียว)
      const claimed = await tx.cfBranchReturn.updateMany({
        where: { id: returnId, orgId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (claimed.count === 0) throw new Error(STATUS_CHANGED);

      const now = new Date();
      for (const ln of sorted) {
        // 🔒 ล็อกต่อ product (เหมือน createBranchReturn) — serialize คืนกลับสาขา
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ln.cfProductId}))`;
        await tx.cfStockMovement.create({
          data: {
            orgId,
            branchId: ret.branchId,
            warehouseId: mainWarehouseId,
            machineId: null,
            type: "TRANSFER_IN",
            productId: ln.cfProductId,
            qty: ln.qty, // คืนกลับสาขา (บวก)
            unitCostCents: ln.unitCostCents,
            occurredAt: now,
            createdById: session.user.id,
            refTable: "cf_branch_return_cancels", // แยกจาก 'cf_branch_returns' (ขาส่งออก) → ไม่ปนกัน
            refId: returnId,
            documentType: "transfer",
            documentId: returnId,
            reason: `ยกเลิกส่งคืน DC · คืนเข้าสาขา · ${ret.returnCode}`,
          },
        });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === STATUS_CHANGED) {
      // อีกคนเปลี่ยนสถานะไปก่อน — ถ้าจบที่ CANCELLED = สำเร็จ (idempotent) · CONFIRMED = รับคืนแล้ว
      const nowRow = await prisma.cfBranchReturn.findFirst({ where: { id: returnId, orgId }, select: { status: true } });
      if (nowRow?.status === "CANCELLED") return { ok: true };
      if (nowRow?.status === "CONFIRMED") return { ok: false, error: "ใบนี้ถูกรับคืนที่ DC แล้ว ยกเลิกไม่ได้" };
      return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ยกเลิกไม่ได้" };
    }
    return { ok: false, error: txErr(e) };
  }
  revalidatePath(RETURN_PATH);
  return { ok: true };
}

// =============================================================
// 4) listPendingBranchReturnsForDc — รายการรอ DC รับคืน (scoped ตามคลังที่มีสิทธิ์)
// =============================================================
export type PendingBranchReturnRow = {
  id: string;
  returnCode: string;
  branchId: string;
  branchName: string;
  toWarehouseId: string;
  note: string | null;
  dispatchedAt: Date;
  itemsCount: number;
  unitsCount: number;
  lines: { productName: string; qty: number }[];
};

export async function listPendingBranchReturnsForDc(warehouseId?: string): Promise<PendingBranchReturnRow[]> {
  const session = await requireSession();
  const orgId = session.user.org_id;
  if (!canDcFloor(session.user.role)) return [];

  // scope: คลังที่ให้กรอง = คลังที่ระบุ (ต้องมีสิทธิ์) หรือทุกคลังที่ผู้ใช้เห็น
  const allowed = await getAllowedWarehouses(session);
  if (warehouseId) {
    await assertWarehouseAllowed(session, warehouseId); // throw ถ้าไม่มีสิทธิ์
  }
  const whIds = warehouseId ? [warehouseId] : allowed.map((w) => w.id);
  if (whIds.length === 0) return [];

  // PENDING = รอรับ · RECEIVING = confirm เริ่มแล้วแต่ค้างกลางทาง (crash) → ยังโชว์ให้กดรับซ้ำเพื่อ resume ได้
  const rows = await prisma.cfBranchReturn.findMany({
    where: { orgId, status: { in: ["PENDING", "RECEIVING"] }, toWarehouseId: { in: whIds } },
    orderBy: { dispatchedAt: "desc" },
    take: 100,
    select: {
      id: true,
      returnCode: true,
      branchId: true,
      toWarehouseId: true,
      note: true,
      dispatchedAt: true,
      lines: { select: { productName: true, qty: true }, orderBy: { productName: "asc" } },
    },
  });

  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const branches = branchIds.length
    ? await prisma.branch.findMany({ where: { id: { in: branchIds }, orgId }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(branches.map((b) => [b.id, b.name]));

  return rows.map((r) => ({
    id: r.id,
    returnCode: r.returnCode,
    branchId: r.branchId,
    branchName: nameMap.get(r.branchId) ?? "สาขา",
    toWarehouseId: r.toWarehouseId,
    note: r.note,
    dispatchedAt: r.dispatchedAt,
    itemsCount: r.lines.length,
    unitsCount: r.lines.reduce((s, l) => s + l.qty, 0),
    lines: r.lines.map((l) => ({ productName: l.productName, qty: l.qty })),
  }));
}
