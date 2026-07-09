"use server";

// DC คลังกลาง · ใบสั่งซื้อจีน (China Purchase Order) — server actions.
//
// 💰 เงินออก · #10 CEO เคาะ: "ไม่มีด่านอนุมัติ" — สร้าง "บันทึก & สั่งเลย" → ORDERED ทันที ·
//   หรือเก็บร่างไว้ก่อน (DRAFT) แล้วค่อยกด "ยืนยันสั่งซื้อ" (markOrdered) → ORDERED ได้เลย.
//   (submitForApproval/approvePo ยังคงไว้สำหรับใบเก่า/องค์กรที่อยากมีด่าน แต่ไม่บังคับ)
//   ยกเลิกได้จาก DRAFT / PENDING_APPROVAL / APPROVED
//
// การ์ดสิทธิ์:
//   • สร้าง/แก้/ส่งอนุมัติ/อนุมัติ/สั่ง/ยกเลิก = canDcManage (ผู้จัดการขึ้นไป)
//   • ผู้อนุมัติ "ควร" ต่างคนกับผู้สร้าง — แต่ถ้ามีผู้จัดการคนเดียวก็อนุมัติเองได้
//     (CEO เคาะ: อย่าล็อกจนสั่งของไม่ได้) → บันทึก approvedByUserId ไว้ตรวจสอบย้อนหลัง
//
// 🏗️ ความปลอดภัยของสถานะ (state machine):
//   ทุก transition ใช้ updateMany WHERE {id, orgId, status: <สถานะที่อนุญาต>} →
//   ถ้ากดซ้ำ/แข่งกัน (race) ครั้งที่สองจะ count===0 = no-op เงียบ ๆ (idempotent)
//   ไม่ double-approve / ไม่ข้ามสถานะ. แก้ไขใบได้เฉพาะตอน DRAFT เท่านั้น.

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { canDcManage, canDcFloor } from "@/lib/dc/role-guard";
import { poCode, genCode, grnCode, shipmentCode } from "@/lib/dc/codes";
import { DcPoStatus, DcPoOrigin, DcProductType, DcPostStatus, DcPoPaymentKind, DcShipmentMode, DcShipmentStatus } from "@/lib/generated/prisma/enums";
import { getTodayFxRate } from "@/lib/dc/fx";
import { postGrn } from "@/lib/dc/grn-actions";
import { computePoFreightSatang } from "@/lib/dc/freight";
import { loadFreightRates } from "@/lib/dc/freight-rates";

const LIST_PATH = "/dc/office/purchasing";

export type PoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** จุดเริ่มของใบ: จีน (สั่งเป็นหยวน) หรือ ไทย (ซื้อในประเทศ เป็นบาท) */
export type PoOriginInput = "CHINA" | "THAI";

export type PoLineInput = {
  productId: string;
  /** ราคา/หน่วยในสกุลของใบ — CNY ถ้าจีน, THB ถ้าไทย (ชื่อ field คงเดิมเพื่อ backward-compat) */
  qty: number;
  unitPriceCny: number;
  photoR2Key?: string | null;
  note?: string | null;
};

export type CreatePoInput = {
  origin?: PoOriginInput;
  supplierId?: string | null;
  warehouseId?: string | null;
  fxRate?: number | null;
  note?: string | null;
  lines: PoLineInput[];
  /** true = บันทึกแล้วเป็น "สั่งแล้ว" ทันที (ไม่มีด่านอนุมัติ · CEO D-#10) · false/undefined = เก็บร่างไว้ก่อน */
  placeOrder?: boolean;
};

export type UpdatePoInput = {
  supplierId?: string | null;
  warehouseId?: string | null;
  fxRate?: number | null;
  note?: string | null;
};

// ── helpers ──────────────────────────────────────────────────

/** Guard: login + canDcManage. */
async function requireManager(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการใบสั่งซื้อจีน" };
  }
  return { ok: true, orgId: session.user.org_id, userId: session.user.id };
}

/**
 * Guard สำหรับ "รับสินค้าเข้าคลัง" — อนุญาตทั้งผู้จัดการ (canDcManage) และพนักงานหน้าคลัง
 * (canDcFloor) เพราะคนหน้าคลังเป็นคนแกะของ/รับเข้าจริง.
 */
async function requireReceiver(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role) && !canDcFloor(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์รับสินค้าเข้าคลัง" };
  }
  return { ok: true, orgId: session.user.org_id, userId: session.user.id };
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** เลขทศนิยมที่ใช้ได้ (>0) หรือ null */
function posNum(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/** จำนวนเต็มไม่ติดลบ (รับ/เสียหาย อาจเป็น 0 ได้). */
function nonNegInt(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

function dec(v: number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function revalidate(id?: string) {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

/**
 * ยืนยันว่าผู้ขาย/คลังที่อ้างถึงเป็นของ org นี้จริง (กันอ้าง id ข้ามองค์กร).
 * ถ้าไม่ส่ง id มา → ผ่าน (เป็น optional).
 */
async function assertRefsInOrg(
  orgId: string,
  supplierId: string | null,
  warehouseId: string | null,
): Promise<string | null> {
  if (supplierId) {
    const s = await prisma.dcSupplier.findFirst({
      where: { id: supplierId, orgId },
      select: { id: true },
    });
    if (!s) return "ไม่พบผู้ขายนี้ในองค์กรของคุณ";
  }
  if (warehouseId) {
    const w = await prisma.dcWarehouse.findFirst({
      where: { id: warehouseId, orgId },
      select: { id: true },
    });
    if (!w) return "ไม่พบคลังนี้ในองค์กรของคุณ";
  }
  return null;
}

/**
 * แปลง 1 บรรทัด input → data สำหรับ create.
 * - ขนาด/ปริมาตร (dims/cbm) ย้ายไปอยู่ที่ "กล่อง" (DcShipment) แล้ว → คอลัมน์พวกนี้เว้น null.
 * - unitPriceCny = ราคา/หน่วยในสกุลของใบ (CNY สำหรับจีน · THB สำหรับไทย).
 * - unitPriceThb: ใบไทย = ราคานั้นเอง (เป็นบาทอยู่แล้ว) · ใบจีน = cny × fxRate (ถ้ามีเรต).
 * productId ต้องเป็นของ org (ผู้เรียกตรวจมาแล้ว).
 */
function buildLineData(
  orgId: string,
  line: PoLineInput,
  origin: DcPoOrigin,
  fxRate: number | null,
) {
  const qty = Math.max(1, Math.trunc(line.qty || 0));
  const price = posNum(line.unitPriceCny) ?? 0;
  const thb =
    origin === DcPoOrigin.THAI ? price : fxRate != null ? price * fxRate : null;

  return {
    orgId,
    productId: line.productId,
    qty,
    unitPriceCny: dec(price),
    unitPriceThb: thb != null ? dec(thb) : null,
    photoR2Key: cleanStr(line.photoR2Key),
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    cbmPerUnit: null,
    note: cleanStr(line.note),
  };
}

// ── สร้างใบ (DRAFT) ──────────────────────────────────────────

export async function createPo(input: CreatePoInput): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const origin = input.origin === "THAI" ? DcPoOrigin.THAI : DcPoOrigin.CHINA;

  const supplierId = cleanStr(input.supplierId);
  const warehouseId = cleanStr(input.warehouseId);

  const lines = (input.lines ?? []).filter((l) => cleanStr(l.productId));
  if (lines.length === 0) {
    return { ok: false, error: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ" };
  }

  const refErr = await assertRefsInOrg(orgId, supplierId, warehouseId);
  if (refErr) return { ok: false, error: refErr };

  // ยืนยันว่าสินค้าทุกบรรทัดเป็นของ org นี้ (กันอ้าง productId ข้ามองค์กร)
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const owned = await prisma.dcProduct.findMany({
    where: { id: { in: productIds }, orgId },
    select: { id: true },
  });
  if (owned.length !== productIds.length) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  // สกุล + เรต ตาม origin:
  //   • ไทย → THB · เรต = 1 (ราคาเป็นบาทอยู่แล้ว)
  //   • จีน → CNY · ใช้เรตที่ส่งมา · ถ้าไม่ส่ง → เติมเรตวันนี้อัตโนมัติ (CNY→THB);
  //           ถ้าดึงไม่ได้ → ปล่อย null (ไม่ fail · เติมทีหลังตอนแก้ใบได้)
  let currency: string;
  let fxRate: number | null;
  if (origin === DcPoOrigin.THAI) {
    currency = "THB";
    fxRate = 1;
  } else {
    currency = "CNY";
    fxRate = posNum(input.fxRate);
    if (fxRate == null) {
      const today = await getTodayFxRate("CNY", "THB");
      fxRate = today != null ? today.rate : null;
    }
  }

  try {
    const po = await prisma.dcPurchaseOrder.create({
      data: {
        orgId,
        poCode: poCode(),
        supplierId: supplierId,
        warehouseId: warehouseId,
        // #10 CEO เคาะ: ไม่มีด่านอนุมัติ — "บันทึก & สั่งเลย" → ORDERED ทันที · "เก็บร่าง" → DRAFT
        status: input.placeOrder ? DcPoStatus.ORDERED : DcPoStatus.DRAFT,
        orderedAt: input.placeOrder ? new Date() : null,
        origin,
        currency,
        fxRate: fxRate != null ? dec(fxRate) : null,
        note: cleanStr(input.note),
        createdByUserId: userId,
        lines: {
          create: lines.map((l) => buildLineData(orgId, l, origin, fxRate)),
        },
      },
      select: { id: true },
    });
    revalidate(po.id);
    return { ok: true, id: po.id };
  } catch {
    return { ok: false, error: "สร้างใบสั่งซื้อไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── แก้ไขหัวใบ (เฉพาะ DRAFT) ─────────────────────────────────

export async function updatePo(
  id: string,
  input: UpdatePoInput,
): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true, origin: true, supplierId: true, fxRate: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  // #3 (CEO 2026-06-29): แก้ผู้ขาย/เรตได้ "ก่อนจ่ายเงิน/ก่อนรับเข้า" — หลังจากนั้นล็อก (ดูประวัติได้)
  //   กันยอดบัญชีเพี้ยน: ถ้าจ่ายเงินไปแล้ว/รับเข้าแล้ว การแก้เรตจะทำให้ยอดที่ลงบัญชีไม่ตรง.
  const LOCKED: DcPoStatus[] = [
    DcPoStatus.RECEIVED,
    DcPoStatus.PARTIAL,
    DcPoStatus.CANCELLED,
    DcPoStatus.CLOSED,
  ];
  if (LOCKED.includes(po.status)) {
    return { ok: false, error: "แก้ไขไม่ได้ — ใบนี้รับเข้าคลัง/ปิด/ยกเลิกแล้ว (ดูประวัติได้)" };
  }
  const paidCount = await prisma.dcPoPayment.count({ where: { orgId, poId: id } });
  if (paidCount > 0) {
    return { ok: false, error: "แก้ไขไม่ได้ — ใบนี้มีบันทึกการจ่ายเงินแล้ว (กันยอดบัญชีเพี้ยน · ดูประวัติได้)" };
  }

  const supplierId = cleanStr(input.supplierId);
  const warehouseId = cleanStr(input.warehouseId);
  // ใบไทย: เรตล็อกที่ 1 (ราคาเป็นบาทอยู่แล้ว) · ใบจีน: ใช้เรตที่ส่งมา
  const fxRate = po.origin === DcPoOrigin.THAI ? 1 : posNum(input.fxRate);

  const refErr = await assertRefsInOrg(orgId, supplierId, warehouseId);
  if (refErr) return { ok: false, error: refErr };

  try {
    // อัปเดต fxRate → คิด unitPriceThb ของทุกบรรทัดใหม่ให้สอดคล้อง + เก็บ log ประวัติ
    await prisma.$transaction(async (tx) => {
      await tx.dcPurchaseOrder.update({
        where: { id },
        data: {
          supplierId,
          warehouseId,
          fxRate: fxRate != null ? dec(fxRate) : null,
          note: cleanStr(input.note),
        },
      });
      const existingLines = await tx.dcPurchaseLine.findMany({
        where: { poId: id, orgId },
        select: { id: true, unitPriceCny: true },
      });
      for (const ln of existingLines) {
        // ไทย: THB = ราคานั้นเอง · จีน: THB = ราคา × เรต (ถ้ามีเรต)
        const price = Number(ln.unitPriceCny);
        const thb =
          po.origin === DcPoOrigin.THAI
            ? price
            : fxRate != null
              ? price * fxRate
              : null;
        await tx.dcPurchaseLine.update({
          where: { id: ln.id },
          data: { unitPriceThb: thb != null ? dec(thb) : null },
        });
      }
      // #3: log ประวัติการแก้ (ใคร/เก่า→ใหม่/เมื่อไหร่) ใน audit_logs (reuse · มี diff Json)
      await tx.auditLog.create({
        data: {
          orgId,
          userId,
          action: "DC_PO_UPDATE",
          resourceType: "dc_purchase_order",
          resourceId: id,
          diff: {
            old: { supplierId: po.supplierId, fxRate: po.fxRate != null ? Number(po.fxRate) : null },
            new: { supplierId, fxRate },
          },
        },
      });
    });
    revalidate(id);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "แก้ไขใบสั่งซื้อไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── เพิ่ม/ลบ บรรทัด (เฉพาะ DRAFT) ────────────────────────────

export async function addLine(
  poId: string,
  line: PoLineInput,
): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true, status: true, fxRate: true, origin: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.DRAFT) {
    return { ok: false, error: "เพิ่มรายการได้เฉพาะใบที่ยังเป็นร่าง (DRAFT)" };
  }
  if (!cleanStr(line.productId)) {
    return { ok: false, error: "กรุณาเลือกสินค้า" };
  }

  // ยืนยันสินค้าเป็นของ org
  const product = await prisma.dcProduct.findFirst({
    where: { id: line.productId, orgId },
    select: { id: true },
  });
  if (!product) return { ok: false, error: "ไม่พบสินค้านี้ในองค์กรของคุณ" };

  const fxRate = po.fxRate != null ? Number(po.fxRate) : null;

  try {
    await prisma.dcPurchaseLine.create({
      data: { poId, ...buildLineData(orgId, line, po.origin, fxRate) },
    });
    revalidate(poId);
    return { ok: true, id: poId };
  } catch {
    return { ok: false, error: "เพิ่มรายการไม่สำเร็จ ลองอีกครั้ง" };
  }
}

export async function removeLine(
  poId: string,
  lineId: string,
): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.DRAFT) {
    return { ok: false, error: "ลบรายการได้เฉพาะใบที่ยังเป็นร่าง (DRAFT)" };
  }

  // ลบเฉพาะบรรทัดของใบนี้ + org นี้ (scope กันลบข้ามใบ/ข้ามองค์กร)
  const res = await prisma.dcPurchaseLine.deleteMany({
    where: { id: lineId, poId, orgId },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบรายการนี้" };
  revalidate(poId);
  return { ok: true, id: poId };
}

// ── เปลี่ยนสถานะ (state machine · idempotent ด้วย WHERE status) ──

/** ส่งขออนุมัติ: DRAFT → PENDING_APPROVAL (ต้องมีรายการอย่างน้อย 1) */
export async function submitPo(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true, _count: { select: { lines: true } } },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.DRAFT) {
    return { ok: false, error: "ส่งขออนุมัติได้เฉพาะใบที่เป็นร่าง (DRAFT)" };
  }
  if (po._count.lines === 0) {
    return { ok: false, error: "ใบสั่งซื้อต้องมีรายการสินค้าก่อนส่งอนุมัติ" };
  }

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.DRAFT },
    data: { status: DcPoStatus.PENDING_APPROVAL },
  });
  if (res.count === 0) return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ลองรีเฟรช" };
  revalidate(id);
  return { ok: true, id };
}

/**
 * อนุมัติ: PENDING_APPROVAL → APPROVED + บันทึก approvedByUserId/approvedAt.
 * ผู้อนุมัติต่างคนกับผู้สร้าง = ดีที่สุด แต่ "อนุญาตให้คนเดียวกันอนุมัติได้"
 * (กรณีมีผู้จัดการคนเดียว — ไม่งั้นสั่งของไม่ได้). canDcManage.
 */
export async function approvePo(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.PENDING_APPROVAL) {
    return { ok: false, error: "อนุมัติได้เฉพาะใบที่รออนุมัติอยู่" };
  }

  // WHERE status=PENDING_APPROVAL → กัน double-approve (กดพร้อมกัน 2 คน ผ่านได้คนเดียว)
  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.PENDING_APPROVAL },
    data: {
      status: DcPoStatus.APPROVED,
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
  });
  if (res.count === 0) return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ลองรีเฟรช" };
  revalidate(id);
  return { ok: true, id };
}

/** ทำเครื่องหมายว่าสั่งแล้ว: APPROVED → ORDERED + orderedAt (เงินออกจริง) */
// #10 CEO เคาะ: DC จัดซื้อ "ไม่มีด่านอนุมัติ" — ใบก่อนสั่ง (ร่าง/รออนุมัติ/อนุมัติ) กด "ยืนยันสั่งซื้อ"
// → ORDERED ได้เลย (ตรงกับ createPo(placeOrder) + UI po-detail ที่โชว์ปุ่มเดียวทุกสถานะก่อนสั่ง).
// เดิม markOrdered ยังบังคับ APPROVED → ใบร่างติด "สั่งได้เฉพาะใบที่อนุมัติแล้ว" (backend ลืมแก้ตาม #10).
const PO_PRE_ORDER: DcPoStatus[] = [DcPoStatus.DRAFT, DcPoStatus.PENDING_APPROVAL, DcPoStatus.APPROVED];
export async function markOrdered(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (!PO_PRE_ORDER.includes(po.status)) {
    return { ok: false, error: "ใบนี้สั่งไปแล้ว/ยกเลิกแล้ว — ยืนยันสั่งซื้อได้เฉพาะใบก่อนสั่ง (ร่าง/รออนุมัติ/อนุมัติ)" };
  }

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: { in: PO_PRE_ORDER } },
    data: { status: DcPoStatus.ORDERED, orderedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ลองรีเฟรช" };
  revalidate(id);
  return { ok: true, id };
}

/** ยกเลิกใบ: ทำได้จาก DRAFT / PENDING_APPROVAL / APPROVED เท่านั้น */
export async function cancelPo(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const CANCELLABLE: DcPoStatus[] = [
    DcPoStatus.DRAFT,
    DcPoStatus.PENDING_APPROVAL,
    DcPoStatus.APPROVED,
  ];

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (!CANCELLABLE.includes(po.status)) {
    return { ok: false, error: "ยกเลิกได้เฉพาะใบที่ยังไม่ได้สั่ง (ร่าง/รออนุมัติ/อนุมัติแล้ว)" };
  }

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: { in: CANCELLABLE } },
    data: { status: DcPoStatus.CANCELLED },
  });
  if (res.count === 0) return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ลองรีเฟรช" };
  revalidate(id);
  return { ok: true, id };
}

// ── สถานะหลังสั่ง (ติดตามการขนส่ง · idempotent ด้วย WHERE status) ──────
//
// ORDERED → SHIPPED → ARRIVED_TH → AT_WAREHOUSE → (receivePo) RECEIVED
// ทุก transition ตรวจ requireManager + updateMany WHERE {id, orgId, status: prev}
// → กดซ้ำ/แข่งกัน = count===0 = no-op เงียบ ๆ (ไม่ข้ามสถานะ).

/** ส่งของแล้ว (ได้เลข tracking): ORDERED → SHIPPED */
export async function markShipped(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.ORDERED },
    data: { status: DcPoStatus.SHIPPED },
  });
  if (res.count === 0) {
    return { ok: false, error: "ทำได้เฉพาะใบที่ 'สั่งแล้ว' (อาจเปลี่ยนสถานะไปแล้ว ลองรีเฟรช)" };
  }
  revalidate(id);
  return { ok: true, id };
}

/**
 * #12 ใส่เลข Tracking จริง: บันทึกเลขลงกล่อง/ชิปเมนต์ของใบนี้ แล้วดันสถานะ ORDERED → SHIPPED
 *  - ถ้าใบมีกล่องอยู่แล้ว → อัปเดตเลข tracking ของกล่องแรก
 *  - ถ้ายังไม่มี → สร้างกล่อง/ชิปเมนต์ใหม่ผูกกับใบ พร้อมเลข tracking
 * (เดิม popup สถานะ ORDERED ไม่มีช่องกรอกเลข — เด้งไปหาเองในส่วนกล่อง · CEO #11,#12)
 */
export async function setPoTracking(input: {
  poId: string;
  trackingNo: string;
  mode?: "TRUCK" | "SEA" | null;
}): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const poId = cleanStr(input.poId);
  if (!poId) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };
  const tracking = cleanStr(input.trackingNo);
  if (!tracking) return { ok: false, error: "กรุณากรอกเลข Tracking" };
  const mode = input.mode === "SEA" ? DcShipmentMode.SEA : DcShipmentMode.TRUCK;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  // บันทึกเลขลงกล่อง: มีกล่องแล้ว → อัปเดตกล่องแรก · ไม่มี → สร้างใหม่
  const existing = await prisma.dcShipment.findFirst({
    where: { poId, orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) {
    await prisma.dcShipment.update({
      where: { id: existing.id },
      data: { trackingNo: tracking, mode },
    });
  } else {
    await prisma.dcShipment.create({
      data: {
        orgId,
        poId,
        shipmentCode: shipmentCode(),
        trackingNo: tracking,
        mode,
        status: DcShipmentStatus.IN_TRANSIT,
      },
    });
  }

  // ดันสถานะ ORDERED → SHIPPED (idempotent: ถ้าเลย SHIPPED ไปแล้วก็แค่บันทึกเลข ไม่ error)
  if (po.status === DcPoStatus.ORDERED) {
    await prisma.dcPurchaseOrder.updateMany({
      where: { id: poId, orgId, status: DcPoStatus.ORDERED },
      data: { status: DcPoStatus.SHIPPED },
    });
  }
  revalidate(poId);
  return { ok: true, id: poId };
}

/** ถึงไทยแล้ว: SHIPPED → ARRIVED_TH */
export async function markArrivedTh(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.SHIPPED },
    data: { status: DcPoStatus.ARRIVED_TH },
  });
  if (res.count === 0) {
    return { ok: false, error: "ทำได้เฉพาะใบที่ 'ส่งแล้ว' (อาจเปลี่ยนสถานะไปแล้ว ลองรีเฟรช)" };
  }
  revalidate(id);
  return { ok: true, id };
}

/** ถึงโกดังแล้ว (ยังไม่แกะ): ARRIVED_TH → AT_WAREHOUSE */
export async function markAtWarehouse(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  // #4 (CEO 2026-06-29): ตัดด่าน "ค่าของ" ทิ้ง — ค่าสินค้าจ่ายตั้งแต่ตอนซื้อแล้ว.
  //   ถึงโกดังไทย = แค่ยืนยันว่าของถึง (ไม่มีด่านเงินตรงนี้). ค่าขนส่งจีน-ไทยไปจ่ายตอน "พร้อมรับเข้า".
  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.ARRIVED_TH },
    data: { status: DcPoStatus.AT_WAREHOUSE },
  });
  if (res.count === 0) {
    return { ok: false, error: "ทำได้เฉพาะใบที่ 'ถึงไทย' (อาจเปลี่ยนสถานะไปแล้ว ลองรีเฟรช)" };
  }
  revalidate(id);
  return { ok: true, id };
}

/**
 * #6 (CEO 2026-06-29): "พร้อมรับเข้า" = จ่ายค่าขนส่งจีน-ไทยแล้ว + ของถึงโกดังแล้ว
 *   แต่ "ยังไม่นับเข้าสต๊อก". AT_WAREHOUSE → READY_TO_RECEIVE.
 *   ใบจีนต้องมีบันทึกจ่าย "ค่าขนส่งจีน-ไทย" (THAI_FREIGHT) ก่อน.
 *   การรับเข้าสต๊อกจริง (GRN) แยกไปทำที่ปุ่ม "รับเข้าคลัง" (receivePo).
 */
export async function markReadyToReceive(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { origin: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.origin === DcPoOrigin.CHINA) {
    const paidFreight = await prisma.dcPoPayment.count({
      where: { orgId, poId: id, kind: DcPoPaymentKind.THAI_FREIGHT },
    });
    if (paidFreight === 0) {
      return { ok: false, error: "ต้องบันทึกการจ่าย 'ค่าขนส่งจีน-ไทย' ก่อน จึงจะกด 'พร้อมรับเข้า' ได้" };
    }
  }

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.AT_WAREHOUSE },
    data: { status: DcPoStatus.READY_TO_RECEIVE },
  });
  if (res.count === 0) {
    return { ok: false, error: "ทำได้เฉพาะใบที่ 'ถึงโกดังแล้ว' (อาจเปลี่ยนสถานะไปแล้ว ลองรีเฟรช)" };
  }
  revalidate(id);
  return { ok: true, id };
}

// ── ย้อนสถานะ 1 ขั้น (กดผิด) ─────────────────────────────────────────
// เฉพาะช่วงขนส่งที่ "ไม่แตะเงิน/สต๊อก/บัญชี" → ย้อนได้ปลอดภัย:
//   SHIPPED→ORDERED · ARRIVED_TH→SHIPPED · AT_WAREHOUSE→ARRIVED_TH · READY_TO_RECEIVE→AT_WAREHOUSE
// 🔴 ห้ามย้อนออกจาก RECEIVED/PARTIAL/CLOSED — receivePo ตัดสต๊อก + คิดต้นทุน landed + ดัน TRCloud แล้ว
//    (ย้อนสถานะเฉย ๆ = สถานะบอก "ยังไม่รับ" แต่ของ+บัญชีเข้าไปแล้ว → เพี้ยนถาวร) → ต้องทำใบกลับรายการแยก.
const PO_REVERT_PREV: Partial<Record<DcPoStatus, DcPoStatus>> = {
  [DcPoStatus.SHIPPED]: DcPoStatus.ORDERED,
  [DcPoStatus.ARRIVED_TH]: DcPoStatus.SHIPPED,
  [DcPoStatus.AT_WAREHOUSE]: DcPoStatus.ARRIVED_TH,
  [DcPoStatus.READY_TO_RECEIVE]: DcPoStatus.AT_WAREHOUSE,
};

export async function revertPoStatus(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  if (po.status === DcPoStatus.RECEIVED || po.status === DcPoStatus.PARTIAL || po.status === DcPoStatus.CLOSED) {
    return { ok: false, error: "ย้อนไม่ได้ — ใบนี้รับเข้าคลังแล้ว (ตัดสต๊อก + ลงบัญชีไปแล้ว) · ถ้าต้องแก้ต้องทำใบกลับรายการ" };
  }
  const prev = PO_REVERT_PREV[po.status];
  if (!prev) return { ok: false, error: "ย้อนสถานะขั้นนี้ไม่ได้" };

  // idempotent: updateMany WHERE status=ปัจจุบัน → กดแข่ง/ซ้ำ = count 0 = no-op
  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: po.status },
    data: { status: prev },
  });
  if (res.count === 0) return { ok: false, error: "สถานะใบเปลี่ยนไปแล้ว ลองรีเฟรช" };
  revalidate(id);
  return { ok: true, id };
}

// ── สร้างสินค้า/ผู้ขายแบบเร็ว (inline ในฟอร์มใบสั่งซื้อ) ─────────────────

export type QuickCreateProductResult =
  | { ok: true; product: { id: string; name: string; sku: string } }
  | { ok: false; error: string };

export type QuickCreateSupplierResult =
  | { ok: true; supplier: { id: string; name: string } }
  | { ok: false; error: string };

export type QuickCreateProductInput = {
  name: string;
  category?: string | null;
  type?: "SALE" | "SPARE";
  barcode?: string | null;
  unit?: string | null;
  imageR2Path?: string | null;
};

export type QuickCreateSupplierInput = {
  name: string;
  contact?: string | null;
  wechat?: string | null;
};

function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

/** SKU อัตโนมัติ: คำนำหน้าจากหมวด (ตัวอักษรล้วน ≤4) + รหัสสุ่ม (กันชนด้วย retry P2002). */
function autoSku(category: string | null): string {
  const prefix = (category ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);
  return prefix.length >= 2 ? genCode(prefix) : genCode("SKU");
}

/**
 * สร้างสินค้าใหม่ "ตรงนี้เลย" จากฟอร์มใบสั่งซื้อ — gen SKU อัตโนมัติ (ไม่ต้องคิดเอง).
 * @@unique([orgId, sku]) → ถ้าสุ่มชน (P2002) retry ได้สูงสุด 5 ครั้ง.
 */
export async function quickCreateProduct(
  input: QuickCreateProductInput,
): Promise<QuickCreateProductResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const name = cleanStr(input.name);
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };

  // #1 (CEO 2026-06-29): กันสร้างชื่อซ้ำ — เช็คชื่อเดิม (ไม่สนตัวพิมพ์เล็ก/ใหญ่) ในองค์กรก่อน
  const dup = await prisma.dcProduct.findFirst({
    where: { orgId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, sku: true },
  });
  if (dup) {
    return { ok: false, error: `มีสินค้าชื่อ "${name}" อยู่แล้ว (รหัส ${dup.sku}) — เลือกจากรายการ หรือใช้ชื่ออื่น` };
  }

  const category = cleanStr(input.category);
  const type = input.type === "SPARE" ? DcProductType.SPARE : DcProductType.SALE;
  const barcode = cleanStr(input.barcode);
  const unit = cleanStr(input.unit) ?? "ชิ้น";
  const imageR2Path = cleanStr(input.imageR2Path);

  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = autoSku(category);
    try {
      const product = await prisma.dcProduct.create({
        data: {
          orgId,
          sku,
          name,
          barcode,
          type,
          unit,
          category,
          imageR2Path,
          active: true,
        },
        select: { id: true, name: true, sku: true },
      });
      revalidatePath(LIST_PATH);
      return { ok: true, product };
    } catch (e) {
      if (errCode(e) === "P2002") continue; // SKU ชน → สุ่มใหม่
      return { ok: false, error: "สร้างสินค้าไม่สำเร็จ ลองอีกครั้ง" };
    }
  }
  return { ok: false, error: "สร้างสินค้าไม่สำเร็จ (รหัสชนกัน) ลองอีกครั้ง" };
}

/** สร้างผู้ขายใหม่ "ตรงนี้เลย" จากฟอร์มใบสั่งซื้อ (default ประเทศ = จีน CN). */
export async function quickCreateSupplier(
  input: QuickCreateSupplierInput,
): Promise<QuickCreateSupplierResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const name = cleanStr(input.name);
  if (!name) return { ok: false, error: "กรุณากรอกชื่อผู้ขาย" };

  try {
    const supplier = await prisma.dcSupplier.create({
      data: {
        orgId,
        name,
        country: "CN",
        contact: cleanStr(input.contact),
        wechat: cleanStr(input.wechat),
        active: true,
      },
      select: { id: true, name: true },
    });
    revalidatePath(LIST_PATH);
    return { ok: true, supplier };
  } catch {
    return { ok: false, error: "สร้างผู้ขายไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── ตัวช่วยเลือกสินค้า/ผู้ขาย (picker ในฟอร์มใบสั่งซื้อ) ──────────────────

export type PoProductOption = { id: string; name: string; sku: string; imageUrl: string | null };
export type PoSupplierOption = { id: string; name: string };

/** ค้นสินค้า active ของ org (ชื่อ/SKU/บาร์โค้ด · insensitive · ≤30) สำหรับ picker. */
export async function searchProductsForPo(
  { q }: { q: string },
): Promise<PoProductOption[]> {
  const g = await requireManager();
  if (!g.ok) return [];
  const { orgId } = g;

  const term = (q ?? "").trim();
  const rows = await prisma.dcProduct.findMany({
    where: {
      orgId,
      active: true,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { sku: { contains: term, mode: "insensitive" } },
              { barcode: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 30,
    select: { id: true, name: true, sku: true, imageR2Path: true },
  });
  // #2: คืน URL รูปพร้อมใช้ (picker ในใบสั่งซื้อจะได้โชว์รูปที่อัปไว้)
  const base = process.env.R2_PUBLIC_URL ?? "";
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    imageUrl: r.imageR2Path
      ? r.imageR2Path.startsWith("http")
        ? r.imageR2Path
        : `${base}/${r.imageR2Path}`
      : null,
  }));
}

/** ผู้ขาย active ของ org (≤200) สำหรับ dropdown ในฟอร์มใบสั่งซื้อ. */
export async function listSuppliersForPo(): Promise<PoSupplierOption[]> {
  const g = await requireManager();
  if (!g.ok) return [];
  const { orgId } = g;

  const rows = await prisma.dcSupplier.findMany({
    where: { orgId, active: true },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });
  return rows;
}

// ── รับสินค้าเข้าคลัง (ผูกกับใบสั่งซื้อ) → RECEIVED ───────────────────────

export type ReceivePoLineInput = {
  productId: string;
  qtyReceived: number;
  qtyDamaged?: number | null;
};

export type ReceivePoInput = {
  poId: string;
  warehouseId: string;
  note?: string | null;
  lines: ReceivePoLineInput[];
};

export type ReceivePoResult =
  | {
      ok: true;
      grnId: string;
      /** TRCloud (บัญชี) เข้าแล้วหรือยัง — false = ลงคลังแล้วแต่ TRCloud ยังไม่เข้า (ให้กดส่งซ้ำ) */
      trcloudPosted: boolean;
      trcloudReason?: string;
    }
  | { ok: false; error: string };

/**
 * "รับสินค้าเข้าคลัง" ของใบสั่งซื้อ 1 ใบ — รวมขั้นตอนให้จบในปุ่มเดียว:
 *   🔒 [ใน lock+tx เดียว] re-read สถานะ → สร้าง GRN+บรรทัด → advance สถานะใบ (atomic)
 *   [นอก lock] postGrn → คิดต้นทุนนำเข้า (landed cost) + ตัดสต๊อกเข้า + ดัน TRCloud (best-effort)
 *
 * สิทธิ์: ผู้จัดการ หรือ พนักงานหน้าคลัง (คนแกะของจริง). org-scope ทุก query.
 *
 * 🏗️ กันรับซ้ำ (idempotency/race):
 *   • serialize ต่อ PO ด้วย pg_advisory_xact_lock (transaction-level — pooler 6543 บังคับ)
 *     → 2 writer รับใบเดียวกันพร้อมกัน วิ่งทีละคน → คนที่ 2 อ่านสถานะที่ถูก advance แล้ว
 *       → ไม่ mint GRN ซ้ำ (ปิดช่องโหว่ self-transition PARTIAL→PARTIAL).
 *   • GRN + advance สถานะ อยู่ tx เดียว → fail = rollback ทั้งก้อน (ไม่มีสถานะลอย/GRN ค้าง).
 *   • postGrn idempotent (sourceKey) + ถ้า fail/ตายกลางคัน → retry วิ่งเข้า noop path แล้ว
 *     re-drive GRN ที่ยังไม่ POSTED ให้สต๊อกเข้าจนครบ (ไม่ค้าง "รับครบ" โดยของไม่เข้า).
 */
export async function receivePo(input: ReceivePoInput): Promise<ReceivePoResult> {
  const g = await requireReceiver();
  if (!g.ok) return g;
  const { orgId } = g;

  const poId = cleanStr(input.poId);
  const warehouseId = cleanStr(input.warehouseId);
  if (!poId) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };
  if (!warehouseId) return { ok: false, error: "กรุณาเลือกคลังปลายทาง" };

  const rawLines = (input.lines ?? []).filter((l) => cleanStr(l.productId));
  if (rawLines.length === 0) {
    return { ok: false, error: "กรุณาระบุรายการที่รับเข้าอย่างน้อย 1 รายการ" };
  }

  // ✅ ใบสั่งซื้อต้องเป็นของ org นี้ (กันรับเข้าใบข้ามองค์กร) — อ่านครั้งแรกนอก lock
  //    เพื่อ "เช็คสิทธิ์/มีจริง" เร็ว ๆ ก่อน. การตัดสินใจจริง (สถานะ/รับซ้ำ) อ่านใหม่
  //    "ภายใน lock" อีกชั้น เพื่อกัน race (ดูบล็อก $transaction ด้านล่าง).
  const poExists = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true, origin: true },
  });
  if (!poExists) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  // 💰 ด่านค่าขนส่งในไทย: ใบจีนต้องบันทึก "จ่ายค่าขนส่งไทยแล้ว" ก่อนรับเข้าคลัง
  // (CEO 2026-06-25: "ถึงโกดังเราแล้วต้องจ่ายค่าขนส่งไทยมาไทย") — เช็คก่อนเข้า lock/tx
  if (poExists.origin === DcPoOrigin.CHINA) {
    const paidFreight = await prisma.dcPoPayment.count({
      where: { orgId, poId, kind: DcPoPaymentKind.THAI_FREIGHT },
    });
    if (paidFreight === 0) {
      return { ok: false, error: "ต้องบันทึกการจ่าย 'ค่าขนส่งในไทย' ก่อน จึงจะรับเข้าคลังได้ (ด่านจ่ายเงินตอนถึงโกดังเรา)" };
    }
  }

  // คลังปลายทางต้องเป็นของ org นี้ (ยืนยันก่อน เพื่อให้ tx สั้น — แตะแต่ DB writes)
  const wh = await prisma.dcWarehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { id: true },
  });
  if (!wh) return { ok: false, error: "ไม่พบคลังนี้ในองค์กรของคุณ" };

  // ยืนยันสินค้าทุกบรรทัดเป็นของ org (กันอ้าง productId ข้ามองค์กร) ก่อนเข้า tx
  const inputProductIds = [...new Set(rawLines.map((l) => cleanStr(l.productId)!))];
  const ownedProducts = await prisma.dcProduct.findMany({
    where: { id: { in: inputProductIds }, orgId },
    select: { id: true },
  });
  if (ownedProducts.length !== inputProductIds.length) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  // รวมบรรทัด productId ซ้ำ → 1 สินค้า = 1 บรรทัด GRN (เลียน logic createGrn → 1 cost layer/สินค้า)
  const mergedMap = new Map<
    string,
    { productId: string; qtyReceived: number; qtyDamaged: number }
  >();
  for (const l of rawLines) {
    const pid = cleanStr(l.productId)!;
    const prev = mergedMap.get(pid);
    if (prev) {
      prev.qtyReceived += nonNegInt(l.qtyReceived);
      prev.qtyDamaged += nonNegInt(l.qtyDamaged);
    } else {
      mergedMap.set(pid, {
        productId: pid,
        qtyReceived: nonNegInt(l.qtyReceived),
        qtyDamaged: nonNegInt(l.qtyDamaged),
      });
    }
  }
  const mergedLines = [...mergedMap.values()];

  // สถานะที่ "รับเข้าได้": สั่งแล้ว/กำลังขนส่ง/ถึงโกดัง หรือรับบางส่วนค้างอยู่ (PARTIAL)
  const RECEIVABLE: DcPoStatus[] = [
    DcPoStatus.ORDERED,
    DcPoStatus.SHIPPED,
    DcPoStatus.ARRIVED_TH,
    DcPoStatus.AT_WAREHOUSE,
    DcPoStatus.READY_TO_RECEIVE,
    DcPoStatus.PARTIAL,
  ];

  // ════════════════════════════════════════════════════════════════════════════
  // 🔒 SERIALIZE การรับเข้า "ต่อใบ" ด้วย transaction-level advisory lock
  //    (Supabase ใช้ pooler port 6543 → session-level pg_advisory_lock ใช้ไม่ได้;
  //     ต้องใช้ pg_advisory_xact_lock "ภายใน $transaction" เท่านั้น).
  //
  //    ทำไมต้อง serialize: ปิดช่องโหว่ (1) — รับบางส่วนบนใบ PARTIAL ที่ยังไม่ครบ.
  //    เดิม CAS เป็น self-transition PARTIAL→PARTIAL (ค่าไม่เปลี่ยน) → 2 writer
  //    พร้อมกันเห็น WHERE ตรงทั้งคู่ → count=1 ทั้งคู่ → mint 2 GRN = ตัดสต๊อก/ดัน
  //    TRCloud ซ้ำ. lock บังคับให้รับเข้า "ใบเดียวกัน" วิ่งทีละคน → คนที่ 2 อ่านสถานะ
  //    ที่ถูก advance แล้วใน lock → ตัดสินใจถูก (no-op ถ้าปิดใบไปแล้ว).
  //
  //    ภายใน lock เราทำให้จบเป็น atomic 1 tx: re-read สถานะ + GRN เดิม → สร้าง GRN
  //    + บรรทัด → advance สถานะใบ. ถ้า step ไหน fail = ทั้ง tx rollback → ไม่มี GRN
  //    ค้าง + สถานะไม่ถูกดันลอย ๆ (กันส่วนหนึ่งของช่องโหว่ (2)). การคิดต้นทุน/ตัดสต๊อก/
  //    ดัน TRCloud (postGrn) ทำ "หลัง" tx เพราะมี network call (ห้ามถือ pooler tx ค้าง
  //    ระหว่างยิง TRCloud) — และ postGrn idempotent อยู่แล้ว (sourceKey) → retry ปลอดภัย.
  // ════════════════════════════════════════════════════════════════════════════
  type TxResult =
    | { kind: "noop" } // ปิดรับครบไปแล้ว — ไม่ต้องทำอะไร
    | { kind: "blocked"; error: string }
    | { kind: "created"; grnId: string };

  let txResult: TxResult;
  try {
    txResult = await prisma.$transaction(async (tx) => {
      // 🔒 ล็อกต่อ PO — serialize ทุกการรับเข้าใบนี้ (transaction-level → ปลดอัตโนมัติตอน commit/rollback)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${poId}))`;

      // re-read "ภายใน lock" — ค่าที่อ่านตรงนี้คือความจริง ณ ขณะถือ lock (ไม่มีใครแทรก)
      const po = await tx.dcPurchaseOrder.findFirst({
        where: { id: poId, orgId },
        select: {
          id: true,
          status: true,
          lines: { select: { productId: true, qty: true } },
        },
      });
      if (!po) return { kind: "blocked", error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

      // ปิดรับครบไปแล้ว (RECEIVED) → no-op (กดซ้ำ/refresh-retry ไม่ mint GRN ใหม่)
      if (po.status === DcPoStatus.RECEIVED) {
        return { kind: "noop" };
      }
      if (!RECEIVABLE.includes(po.status)) {
        return { kind: "blocked", error: "ใบนี้ยังรับเข้าคลังไม่ได้ (ต้องสั่งซื้อกับผู้ขายก่อน)" };
      }

      // จำนวนที่สั่งต่อสินค้า (รวมบรรทัดซ้ำ) → เติม qtyExpected บน GRN line
      const orderedByProduct = new Map<string, number>();
      for (const pl of po.lines) {
        orderedByProduct.set(pl.productId, (orderedByProduct.get(pl.productId) ?? 0) + pl.qty);
      }

      // รับสะสมเดิม (ทุก GRN ของใบนี้) + ที่กำลังจะรับรอบนี้ → เทียบ "สั่งทั้งหมด"
      const priorGrnLines = await tx.dcGoodsReceiptLine.findMany({
        where: { orgId, grn: { poId, orgId } },
        select: { productId: true, qtyReceived: true },
      });
      const projectedByProduct = new Map<string, number>();
      for (const gl of priorGrnLines) {
        projectedByProduct.set(gl.productId, (projectedByProduct.get(gl.productId) ?? 0) + gl.qtyReceived);
      }
      for (const l of mergedLines) {
        projectedByProduct.set(l.productId, (projectedByProduct.get(l.productId) ?? 0) + l.qtyReceived);
      }
      const fullyReceived = [...orderedByProduct.entries()].every(
        ([pid, ordered]) => (projectedByProduct.get(pid) ?? 0) >= ordered,
      );
      const nextStatus = fullyReceived ? DcPoStatus.RECEIVED : DcPoStatus.PARTIAL;

      // สร้าง GRN + บรรทัด "ภายใน lock+tx" (status PENDING — postGrn คิดต้นทุน/ตัดสต๊อกทีหลัง)
      const grn = await tx.dcGoodsReceipt.create({
        data: {
          orgId,
          grnCode: grnCode(),
          warehouseId,
          poId,
          status: "RECEIVED",
          postStatus: DcPostStatus.PENDING,
          note: cleanStr(input.note),
          receivedByUserId: g.userId,
          lines: {
            create: mergedLines.map((l) => ({
              orgId,
              productId: l.productId,
              qtyExpected: orderedByProduct.get(l.productId) ?? 0,
              qtyReceived: l.qtyReceived,
              qtyDamaged: l.qtyDamaged,
            })),
          },
        },
        select: { id: true },
      });

      // advance สถานะใบ "ใน tx เดียวกับ GRN" — ถ้าตรงนี้ fail = rollback ทั้งก้อน (GRN หาย ไม่มีสถานะลอย)
      await tx.dcPurchaseOrder.updateMany({
        where: { id: poId, orgId, status: { in: RECEIVABLE } },
        data: { status: nextStatus },
      });

      return { kind: "created", grnId: grn.id };
    });
  } catch {
    return { ok: false, error: "รับสินค้าเข้าคลังไม่สำเร็จ ลองอีกครั้ง" };
  }

  if (txResult.kind === "blocked") return { ok: false, error: txResult.error };
  if (txResult.kind === "noop") {
    // ใบปิดรับครบไปแล้ว — แต่ "เผื่อ" GRN ของใบนี้ยังคิดต้นทุน/ตัดสต๊อกไม่จบ (เช่น
    // postGrn รอบก่อน fail หรือ process ตายกลางคัน) → re-drive ให้สต๊อกเข้าครบ.
    // postGrn idempotent (sourceKey) + ปฏิเสธ POSTED → ปลอดภัยที่จะเรียกซ้ำ.
    const pending = await prisma.dcGoodsReceipt.findFirst({
      where: { orgId, poId, postStatus: { not: DcPostStatus.POSTED } },
      orderBy: { receivedAt: "asc" },
      select: { id: true },
    });
    if (pending) {
      const posted = await postGrn(pending.id);
      revalidate(poId);
      if (posted.ok) {
        return {
          ok: true,
          grnId: pending.id,
          trcloudPosted: posted.trcloud.posted,
          trcloudReason: posted.trcloud.reason ?? posted.trcloud.error,
        };
      }
    }
    return { ok: true, grnId: "", trcloudPosted: true };
  }

  // ── นอก lock: คิดต้นทุน + ตัดสต๊อก + ดัน TRCloud (มี network → ห้ามถือ pooler tx ค้าง) ──
  // GRN ถูกสร้าง + สถานะใบถูก advance "ภายใน lock" ไปแล้ว → ไม่มีใคร mint GRN ซ้ำได้ (ปิด (1)).
  // postGrn idempotent (sourceKey) — ถ้า fail/ตายกลางคัน: retry receivePo จะวิ่งเข้า "noop"
  // ด้านบนแล้ว re-drive GRN ที่ยังไม่ POSTED ให้สต๊อกเข้าจนครบ (ปิด (2) — ไม่ค้าง "รับครบ" โดยของไม่เข้า).
  const grnId = txResult.grnId;
  const posted = await postGrn(grnId);
  revalidate(poId);
  if (!posted.ok) {
    // สต๊อกยังไม่เข้า แต่ GRN+สถานะอยู่แล้ว → ฝั่ง UI กดรับซ้ำได้ (จะ re-drive ผ่าน noop path).
    return { ok: false, error: posted.error };
  }

  // สถานะ TRCloud จาก postGrn — ถ้า posted=false ฝั่ง UI จะโชว์แถบเหลือง "บัญชียังไม่เข้า · กดส่งซ้ำ"
  return {
    ok: true,
    grnId,
    trcloudPosted: posted.trcloud.posted,
    trcloudReason: posted.trcloud.reason ?? posted.trcloud.error,
  };
}

// ── 💰 การจ่ายเงิน (ด่าน 2 จุด · บันทึกยอด · CEO 2026-06-25) ──────────────
//   GOODS=ค่าของ (จ่าย@ถึงไทย → ปลดล็อก markAtWarehouse)
//   THAI_FREIGHT=ค่าขนส่งในไทย (จ่าย@ถึงโกดังเรา → ปลดล็อก receivePo)
// เก็บเป็น ledger (หลายครั้งได้) · amountSatang = หน่วยย่อย ×100 ของ currency.

export type PoPaymentKindInput = "GOODS" | "THAI_FREIGHT";

export type PoPaymentData = {
  id: string;
  kind: PoPaymentKindInput;
  amountSatang: number;
  currency: string;
  paidAt: string;
  note: string | null;
};

export type RecordPaymentInput = {
  poId: string;
  kind: PoPaymentKindInput;
  amountSatang: number;
  currency?: string | null; // "THB" (ค่าเริ่มต้น) หรือ "CNY"
  paidAt?: string | null; // ISO; ว่าง = ตอนนี้
  note?: string | null;
};

export async function recordPoPayment(input: RecordPaymentInput): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const poId = cleanStr(input.poId);
  if (!poId) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };
  const amount = nonNegInt(input.amountSatang);
  if (amount <= 0) return { ok: false, error: "กรุณาระบุยอดเงินที่จ่าย (มากกว่า 0)" };
  const kind = input.kind === "THAI_FREIGHT" ? DcPoPaymentKind.THAI_FREIGHT : DcPoPaymentKind.GOODS;
  // #5 (CEO 2026-06-29): ค่าขนส่งจีน-ไทย = บาทเท่านั้น (ไม่มีหยวน)
  const currency =
    kind === DcPoPaymentKind.THAI_FREIGHT
      ? "THB"
      : cleanStr(input.currency) === "CNY"
        ? "CNY"
        : "THB";

  // ใบต้องเป็นของ org นี้ (กันบันทึกจ่ายข้ามองค์กร)
  const po = await prisma.dcPurchaseOrder.findFirst({ where: { id: poId, orgId }, select: { id: true } });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  const parsed = input.paidAt ? new Date(input.paidAt) : new Date();
  const paidAt = isNaN(parsed.getTime()) ? new Date() : parsed;

  await prisma.dcPoPayment.create({
    data: { orgId, poId, kind, amountSatang: amount, currency, paidAt, paidByUserId: userId, note: cleanStr(input.note) },
  });
  revalidate(poId);
  return { ok: true, id: poId };
}

export async function deletePoPayment(paymentId: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;
  const id = cleanStr(paymentId);
  if (!id) return { ok: false, error: "ไม่พบรายการจ่ายเงิน" };
  // ลบได้เฉพาะของ org ตัวเอง
  const res = await prisma.dcPoPayment.deleteMany({ where: { id, orgId } });
  if (res.count === 0) return { ok: false, error: "ไม่พบรายการจ่ายเงินนี้" };
  revalidate();
  return { ok: true, id };
}

// ── 💰 จ่ายรวมหลายใบทีเดียว (#13) ────────────────────────────────
// "ของถึงแล้วจ่ายค่าขนส่ง · เลือกหลายใบ กดจ่ายทีเดียว"
// แต่ละใบยังได้ payment record ของตัวเอง (ด่านเงินรายใบทำงานเหมือนเดิม) — แค่แสตมป์ batchId เดียวกัน

export type PayableRow = {
  poId: string;
  poCode: string;
  supplierName: string | null;
  status: string;
  /** ยอดที่ "ระบบแนะนำ" (จากราคาสินค้า/ค่าขนส่งที่บันทึกไว้) — แก้ได้ตอนจ่ายจริง */
  suggestedSatang: number;
};

/** รายการใบที่ยังค้างจ่าย kind นี้ (จีนเท่านั้น) — ให้หน้า "รวมจ่าย" เอาไปแสดงเลือกติ๊ก */
export async function getPayableOutstanding(
  kindInput: PoPaymentKindInput,
): Promise<PayableRow[]> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return [];
  const orgId = session.user.org_id;
  const kind = kindInput === "THAI_FREIGHT" ? DcPoPaymentKind.THAI_FREIGHT : DcPoPaymentKind.GOODS;

  // GOODS = ค่าของ (ด่านตอน ARRIVED_TH) · THAI_FREIGHT = ค่าขนส่งไทย (ด่านตอน AT_WAREHOUSE/PARTIAL)
  const statuses =
    kind === DcPoPaymentKind.GOODS
      ? [DcPoStatus.ARRIVED_TH]
      : [DcPoStatus.AT_WAREHOUSE, DcPoStatus.PARTIAL];

  const pos = await prisma.dcPurchaseOrder.findMany({
    where: {
      orgId,
      origin: DcPoOrigin.CHINA,
      status: { in: statuses },
      payments: { none: { kind } }, // ยังไม่มี payment ชนิดนี้
    },
    orderBy: { orderedAt: "asc" },
    select: {
      id: true,
      poCode: true,
      status: true,
      fxRate: true,
      supplier: { select: { name: true } },
      lines: { select: { qty: true, unitPriceCny: true, unitPriceThb: true } },
    },
  });

  // #4: ค่าขนส่งจีน-ไทย ที่แนะนำต่อใบ = Σ(cbm × เรตต่อคิว) · fallback ยอดเดิมถ้ายังไม่ตั้งเรต
  const freightByPo = new Map<string, number>();
  if (kind === DcPoPaymentKind.THAI_FREIGHT && pos.length > 0) {
    const rates = await loadFreightRates(orgId);
    const ships = await prisma.dcShipment.findMany({
      where: { orgId, poId: { in: pos.map((p) => p.id) } },
      select: { poId: true, mode: true, cbmTotal: true, chinaFreightThbSatang: true, intlFreightThbSatang: true },
    });
    const byPo = new Map<string, typeof ships>();
    for (const s of ships) {
      if (!s.poId) continue;
      const arr = byPo.get(s.poId) ?? [];
      arr.push(s);
      byPo.set(s.poId, arr);
    }
    for (const [pid, arr] of byPo) {
      freightByPo.set(
        pid,
        computePoFreightSatang(
          arr.map((s) => ({
            cbmTotal: s.cbmTotal != null ? Number(s.cbmTotal) : null,
            mode: s.mode,
            chinaFreightThbSatang: s.chinaFreightThbSatang,
            intlFreightThbSatang: s.intlFreightThbSatang,
          })),
          rates,
        ),
      );
    }
  }

  return pos.map((p) => {
    let suggestedSatang = 0;
    if (kind === DcPoPaymentKind.GOODS) {
      const fx = p.fxRate != null ? Number(p.fxRate) : 1;
      const thb = p.lines.reduce((sum, l) => {
        const unitThb = l.unitPriceThb != null ? Number(l.unitPriceThb) : Number(l.unitPriceCny) * fx;
        return sum + l.qty * unitThb;
      }, 0);
      suggestedSatang = Math.round(thb * 100);
    } else {
      suggestedSatang = freightByPo.get(p.id) ?? 0;
    }
    return { poId: p.id, poCode: p.poCode, supplierName: p.supplier?.name ?? null, status: p.status, suggestedSatang };
  });
}

export type BulkPaymentInput = {
  kind: PoPaymentKindInput;
  items: { poId: string; amountSatang: number }[];
  currency?: string | null; // ค่าเริ่มต้น THB
  paidAt?: string | null;
  note?: string | null;
};

/** จ่ายหลายใบในคราวเดียว — สร้าง payment ต่อใบ + แสตมป์ batchId เดียวกัน (atomic ทั้งก้อน) */
export async function recordBulkPayment(
  input: BulkPaymentInput,
): Promise<{ ok: true; count: number; batchId: string } | { ok: false; error: string }> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const kind = input.kind === "THAI_FREIGHT" ? DcPoPaymentKind.THAI_FREIGHT : DcPoPaymentKind.GOODS;
  // #5: ค่าขนส่งจีน-ไทย = บาทเท่านั้น
  const currency =
    kind === DcPoPaymentKind.THAI_FREIGHT
      ? "THB"
      : cleanStr(input.currency) === "CNY"
        ? "CNY"
        : "THB";
  const parsed = input.paidAt ? new Date(input.paidAt) : new Date();
  const paidAt = isNaN(parsed.getTime()) ? new Date() : parsed;

  const items = (input.items ?? [])
    .map((it) => ({ poId: cleanStr(it.poId), amountSatang: nonNegInt(it.amountSatang) }))
    .filter((it) => it.poId && it.amountSatang > 0) as { poId: string; amountSatang: number }[];
  if (items.length === 0) return { ok: false, error: "กรุณาเลือกใบที่จะจ่าย และระบุยอดมากกว่า 0" };

  // ทุกใบต้องเป็นของ org นี้ (กันจ่ายข้ามองค์กร)
  const ids = [...new Set(items.map((it) => it.poId))];
  const owned = await prisma.dcPurchaseOrder.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  if (owned.length !== ids.length) return { ok: false, error: "มีบางใบไม่อยู่ในองค์กรของคุณ" };

  const batchId = randomUUID();
  await prisma.$transaction(
    items.map((it) =>
      prisma.dcPoPayment.create({
        data: {
          orgId,
          poId: it.poId,
          kind,
          amountSatang: it.amountSatang,
          currency,
          paidAt,
          paidByUserId: userId,
          note: cleanStr(input.note),
          batchId,
        },
      }),
    ),
  );
  revalidate();
  return { ok: true, count: items.length, batchId };
}

// ── 🔎 โหลดรายละเอียดใบสำหรับ panel master-detail (เรียกจาก client ตอนเลือกใบ) ──
// คืนชุดข้อมูลเดียวกับหน้า /[id] + payments + paid flags + คลังที่เข้าถึงได้
// → ฝั่ง client เอาไป render <PoDetail/> ในแผงขวาได้โดยไม่ต้องเปลี่ยนหน้า.

export type PanelLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unitPriceCny: number;
  unitPriceThb: number | null;
  photoR2Key: string | null;
  note: string | null;
};

export type PanelBoxContent = { id: string; productId: string; name: string; qty: number };

export type PanelBox = {
  id: string;
  shipmentCode: string;
  trackingNo: string | null;
  mode: string;
  status: string;
  cbmTotal: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  note: string | null;
  contents: PanelBoxContent[];
};

export type PanelData = {
  id: string;
  poCode: string;
  status: string;
  origin: string;
  currency: string;
  fxRate: number | null;
  note: string | null;
  supplierName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  createdAt: string;
  lines: PanelLine[];
  boxes: PanelBox[];
};

export type PoPanelBundle = {
  data: PanelData;
  payments: PoPaymentData[];
  goodsPaid: boolean;
  thaiFreightPaid: boolean;
  /** ยอด "ค่าของ" ที่ระบบแนะนำ (รวมราคาสินค้าทั้งใบ เป็นบาท·สตางค์) — prefill ตอนจ่าย แก้ได้ */
  goodsOwedSatang: number;
  /** ยอด "ค่าขนส่งจีน-ไทย" คิดอัตโนมัติ Σ(cbm × เรตต่อคิว) บาท·สตางค์ — prefill ตอนจ่าย แก้ได้ (#4) */
  freightOwedSatang: number;
  /** ตั้งเรตค่าขนส่งต่อคิวแล้วหรือยัง — false = freightOwed มาจากยอดเดิม/0 (ควรเตือนให้ไปตั้งเรต) */
  freightRatesConfigured: boolean;
  warehouses: { id: string; name: string }[];
  r2PublicUrl: string;
};

export async function getPoDetailForPanel(poIdRaw: string): Promise<PoPanelBundle | null> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return null;
  const orgId = session.user.org_id;
  const poId = cleanStr(poIdRaw);
  if (!poId) return null;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: {
      id: true, poCode: true, status: true, origin: true, currency: true, fxRate: true, note: true,
      warehouseId: true, createdByUserId: true, approvedByUserId: true, approvedAt: true, orderedAt: true, createdAt: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true, qty: true, unitPriceCny: true, unitPriceThb: true, photoR2Key: true, note: true,
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!po) return null;

  const boxes = await prisma.dcShipment.findMany({
    where: { poId, orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, shipmentCode: true, trackingNo: true, mode: true, status: true, cbmTotal: true,
      lengthCm: true, widthCm: true, heightCm: true, note: true,
      chinaFreightThbSatang: true, intlFreightThbSatang: true,
      lines: { select: { id: true, productId: true, qty: true } },
    },
  });

  // ชื่อสินค้าทั้งหมด (บรรทัดใบ + ของในกล่อง) → 1 query เสริม
  const productNames = new Map<string, string>();
  for (const l of po.lines) productNames.set(l.product.id, l.product.name);
  const missing = new Set<string>();
  for (const b of boxes) for (const bl of b.lines) if (!productNames.has(bl.productId)) missing.add(bl.productId);
  if (missing.size > 0) {
    const extra = await prisma.dcProduct.findMany({ where: { id: { in: [...missing] }, orgId }, select: { id: true, name: true } });
    for (const p of extra) productNames.set(p.id, p.name);
  }

  let warehouseName: string | null = null;
  if (po.warehouseId) {
    const w = await prisma.dcWarehouse.findFirst({ where: { id: po.warehouseId, orgId }, select: { name: true } });
    warehouseName = w?.name ?? null;
  }
  const nameOf = async (userId: string | null): Promise<string | null> => {
    if (!userId) return null;
    try {
      const u = await prisma.user.findFirst({ where: { id: userId, orgId }, select: { name: true, email: true } });
      return u?.name ?? u?.email ?? null;
    } catch {
      return null;
    }
  };
  const [createdBy, approvedBy] = await Promise.all([nameOf(po.createdByUserId), nameOf(po.approvedByUserId)]);

  const paymentRows = await prisma.dcPoPayment.findMany({
    where: { orgId, poId },
    orderBy: { paidAt: "asc" },
    select: { id: true, kind: true, amountSatang: true, currency: true, paidAt: true, note: true },
  });
  const payments: PoPaymentData[] = paymentRows.map((p) => ({
    id: p.id,
    kind: p.kind === DcPoPaymentKind.THAI_FREIGHT ? "THAI_FREIGHT" : "GOODS",
    amountSatang: p.amountSatang,
    currency: p.currency,
    paidAt: p.paidAt.toISOString(),
    note: p.note,
  }));
  const goodsPaid = payments.some((p) => p.kind === "GOODS");
  const thaiFreightPaid = payments.some((p) => p.kind === "THAI_FREIGHT");

  // ยอดแนะนำ (prefill ตอนจ่าย · แก้ได้): ค่าของ = ราคารวมทั้งใบ(บาท) · ค่าขนส่ง = freight ที่บันทึกในกล่อง
  const poFx = po.fxRate != null ? Number(po.fxRate) : 1;
  const goodsOwedSatang = Math.round(
    po.lines.reduce((s, l) => {
      const unitThb = l.unitPriceThb != null ? Number(l.unitPriceThb) : Number(l.unitPriceCny) * poFx;
      return s + l.qty * unitThb;
    }, 0) * 100,
  );
  // #4: ค่าขนส่งจีน-ไทย = Σ(cbm × เรตต่อคิว) อัตโนมัติ · fallback ยอดเดิมถ้ายังไม่ตั้งเรต
  const freightRates = await loadFreightRates(orgId);
  const freightOwedSatang = computePoFreightSatang(
    boxes.map((b) => ({
      cbmTotal: b.cbmTotal != null ? Number(b.cbmTotal) : null,
      mode: b.mode,
      chinaFreightThbSatang: b.chinaFreightThbSatang,
      intlFreightThbSatang: b.intlFreightThbSatang,
    })),
    freightRates,
  );
  const freightRatesConfigured = freightRates.TRUCK > 0 || freightRates.SEA > 0;

  // คลังที่ผู้ใช้เข้าถึง (สำหรับ dropdown รับเข้า) — best-effort ผ่าน DcWarehouseUser/admin
  const whRows = await prisma.dcWarehouse.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  const data: PanelData = {
    id: po.id,
    poCode: po.poCode,
    status: po.status,
    origin: po.origin,
    currency: po.currency,
    fxRate: po.fxRate != null ? Number(po.fxRate) : null,
    note: po.note,
    supplierName: po.supplier?.name ?? null,
    warehouseId: po.warehouseId,
    warehouseName,
    createdBy,
    approvedBy,
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
    lines: po.lines.map((l) => ({
      id: l.id,
      productId: l.product.id,
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      qty: l.qty,
      unitPriceCny: Number(l.unitPriceCny),
      unitPriceThb: l.unitPriceThb != null ? Number(l.unitPriceThb) : null,
      photoR2Key: l.photoR2Key,
      note: l.note,
    })),
    boxes: boxes.map((b) => ({
      id: b.id,
      shipmentCode: b.shipmentCode,
      trackingNo: b.trackingNo,
      mode: b.mode,
      status: b.status,
      cbmTotal: b.cbmTotal != null ? Number(b.cbmTotal) : null,
      lengthCm: b.lengthCm != null ? Number(b.lengthCm) : null,
      widthCm: b.widthCm != null ? Number(b.widthCm) : null,
      heightCm: b.heightCm != null ? Number(b.heightCm) : null,
      note: b.note,
      contents: b.lines.map((bl) => ({ id: bl.id, productId: bl.productId, name: productNames.get(bl.productId) ?? "— สินค้า —", qty: bl.qty })),
    })),
  };

  return { data, payments, goodsPaid, thaiFreightPaid, goodsOwedSatang, freightOwedSatang, freightRatesConfigured, warehouses: whRows, r2PublicUrl: process.env.R2_PUBLIC_URL ?? "" };
}

// ── #3 ประวัติการแก้ใบสั่งซื้อ (audit log · ใคร/เก่า→ใหม่/เมื่อไหร่) ─────────
export type PoAuditEntry = {
  id: string;
  userName: string | null;
  createdAt: string;
  diff: { old?: Record<string, unknown>; new?: Record<string, unknown> } | null;
};

export async function getPoAuditHistory(poIdRaw: string): Promise<PoAuditEntry[]> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return [];
  const orgId = session.user.org_id;
  const poId = cleanStr(poIdRaw);
  if (!poId) return [];
  const rows = await prisma.auditLog.findMany({
    where: { orgId, resourceType: "dc_purchase_order", resourceId: poId, action: "DC_PO_UPDATE" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, createdAt: true, diff: true, user: { select: { name: true, email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    userName: r.user?.name ?? r.user?.email ?? null,
    createdAt: r.createdAt.toISOString(),
    diff: (r.diff as PoAuditEntry["diff"]) ?? null,
  }));
}

// ── #12e เทียบใบสั่งซื้อ vs ใบรับทั้งหมด (สั่ง / รับสะสม / คงค้าง) ─────────
export type PoReceiveProductRow = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  ordered: number;
  received: number;
  remaining: number;
};
export type PoReceiveGrnRow = {
  grnId: string;
  grnCode: string;
  receivedAt: string;
  totalReceived: number;
};
export type PoReceiveSummary = {
  products: PoReceiveProductRow[];
  grns: PoReceiveGrnRow[];
  fullyReceived: boolean;
};

export async function getPoReceivingSummary(poIdRaw: string): Promise<PoReceiveSummary | null> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) return null;
  const orgId = session.user.org_id;
  const poId = cleanStr(poIdRaw);
  if (!poId) return null;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: {
      id: true,
      lines: { select: { qty: true, product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  });
  if (!po) return null;

  const grns = await prisma.dcGoodsReceipt.findMany({
    where: { orgId, poId },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      grnCode: true,
      receivedAt: true,
      lines: { select: { productId: true, qtyReceived: true } },
    },
  });

  const orderedByProduct = new Map<string, { sku: string; name: string; unit: string; ordered: number }>();
  for (const l of po.lines) {
    const prev = orderedByProduct.get(l.product.id);
    if (prev) prev.ordered += l.qty;
    else orderedByProduct.set(l.product.id, { sku: l.product.sku, name: l.product.name, unit: l.product.unit, ordered: l.qty });
  }
  const receivedByProduct = new Map<string, number>();
  for (const grn of grns) {
    for (const gl of grn.lines) {
      receivedByProduct.set(gl.productId, (receivedByProduct.get(gl.productId) ?? 0) + gl.qtyReceived);
    }
  }

  const products: PoReceiveProductRow[] = [...orderedByProduct.entries()].map(([productId, p]) => {
    const received = receivedByProduct.get(productId) ?? 0;
    return { productId, sku: p.sku, name: p.name, unit: p.unit, ordered: p.ordered, received, remaining: p.ordered - received };
  });
  const fullyReceived = products.length > 0 && products.every((p) => p.received >= p.ordered);

  return {
    products,
    grns: grns.map((gr) => ({
      grnId: gr.id,
      grnCode: gr.grnCode,
      receivedAt: gr.receivedAt.toISOString(),
      totalReceived: gr.lines.reduce((s, l) => s + l.qtyReceived, 0),
    })),
    fullyReceived,
  };
}
