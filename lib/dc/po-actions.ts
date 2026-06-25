"use server";

// DC คลังกลาง · ใบสั่งซื้อจีน (China Purchase Order) — server actions.
//
// 💰 เงินออก → ต้องมี "อนุมัติ 1 คน" ก่อนถึงสถานะ "สั่งแล้ว" (workshop-locked):
//   DRAFT → (submit) PENDING_APPROVAL → (approve) APPROVED → (markOrdered) ORDERED
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

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { canDcManage, canDcFloor } from "@/lib/dc/role-guard";
import { poCode, genCode } from "@/lib/dc/codes";
import { DcPoStatus, DcPoOrigin, DcProductType } from "@/lib/generated/prisma/enums";
import { getTodayFxRate } from "@/lib/dc/fx";
import { createGrn, postGrn } from "@/lib/dc/grn-actions";

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
        status: DcPoStatus.DRAFT,
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
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true, origin: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.DRAFT) {
    return { ok: false, error: "แก้ไขได้เฉพาะใบที่ยังเป็นร่าง (DRAFT)" };
  }

  const supplierId = cleanStr(input.supplierId);
  const warehouseId = cleanStr(input.warehouseId);
  // ใบไทย: เรตล็อกที่ 1 (ราคาเป็นบาทอยู่แล้ว) · ใบจีน: ใช้เรตที่ส่งมา
  const fxRate = po.origin === DcPoOrigin.THAI ? 1 : posNum(input.fxRate);

  const refErr = await assertRefsInOrg(orgId, supplierId, warehouseId);
  if (refErr) return { ok: false, error: refErr };

  try {
    // อัปเดต fxRate → คิด unitPriceThb ของทุกบรรทัดใหม่ให้สอดคล้อง
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
export async function markOrdered(id: string): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.APPROVED) {
    return { ok: false, error: "สั่งได้เฉพาะใบที่อนุมัติแล้ว" };
  }

  const res = await prisma.dcPurchaseOrder.updateMany({
    where: { id, orgId, status: DcPoStatus.APPROVED },
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

export type PoProductOption = { id: string; name: string; sku: string };
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
    select: { id: true, name: true, sku: true },
  });
  return rows;
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
 *   1) createGrn (ผูก poId + คลัง + หมายเหตุ + รายการที่รับจริง/เสียหาย)
 *   2) postGrn  → คิดต้นทุนนำเข้า (landed cost) + ตัดสต๊อกเข้า + ดัน TRCloud (best-effort)
 *   3) ดันสถานะใบ → RECEIVED (idempotent · WHERE status ∈ ระหว่างทาง/ถึงโกดัง)
 *
 * สิทธิ์: ผู้จัดการ หรือ พนักงานหน้าคลัง (คนแกะของจริง). org-scope ทุก query.
 * ⚠️ คิดต้นทุน/ตัดสต๊อก/TRCloud เป็น idempotent อยู่แล้วในชั้น bridge (sourceKey).
 */
export async function receivePo(input: ReceivePoInput): Promise<ReceivePoResult> {
  const g = await requireReceiver();
  if (!g.ok) return g;
  const { orgId } = g;

  const poId = cleanStr(input.poId);
  const warehouseId = cleanStr(input.warehouseId);
  if (!poId) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };
  if (!warehouseId) return { ok: false, error: "กรุณาเลือกคลังปลายทาง" };

  // ใบสั่งซื้อต้องเป็นของ org นี้ (กันรับเข้าใบข้ามองค์กร) + ดึงสถานะ + รายการที่สั่ง
  // (qty ต่อสินค้า) มาด้วย เพื่อ (ก) idempotent กดซ้ำ (ข) เช็คสถานะ (ค) เติม qtyExpected
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: {
      id: true,
      status: true,
      lines: { select: { productId: true, qty: true } },
    },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  // Idempotent no-op: ถ้าใบถูกปิดรับครบไปแล้ว (RECEIVED) → กดซ้ำ/refresh-retry ไม่สร้าง GRN ใหม่
  // (ไม่งั้นแต่ละครั้งจะ mint GRN ใหม่ → สต๊อก + TRCloud เด้ง 2 เท่า). คืน ok เฉย ๆ.
  if (po.status === DcPoStatus.RECEIVED) {
    return { ok: true, grnId: "", trcloudPosted: true };
  }

  // ด่านสถานะ: รับเข้าได้เฉพาะใบที่สั่งแล้ว/กำลังขนส่ง/ถึงโกดัง หรือรับบางส่วนค้างอยู่ (PARTIAL)
  const RECEIVABLE: DcPoStatus[] = [
    DcPoStatus.ORDERED,
    DcPoStatus.SHIPPED,
    DcPoStatus.ARRIVED_TH,
    DcPoStatus.AT_WAREHOUSE,
    DcPoStatus.PARTIAL,
  ];
  if (!RECEIVABLE.includes(po.status)) {
    return { ok: false, error: "ใบนี้ยังรับเข้าคลังไม่ได้ (ต้องสั่งซื้อกับผู้ขายก่อน)" };
  }

  const rawLines = (input.lines ?? []).filter((l) => cleanStr(l.productId));
  if (rawLines.length === 0) {
    return { ok: false, error: "กรุณาระบุรายการที่รับเข้าอย่างน้อย 1 รายการ" };
  }

  // จำนวนที่สั่งต่อสินค้า (รวมบรรทัดซ้ำ productId เข้าด้วยกัน) → ใช้เติม qtyExpected บน GRN line
  const orderedByProduct = new Map<string, number>();
  for (const pl of po.lines) {
    orderedByProduct.set(pl.productId, (orderedByProduct.get(pl.productId) ?? 0) + pl.qty);
  }

  // 1) สร้างใบรับสินค้า (createGrn ตรวจคลัง/สินค้า/PO เป็นของ org เองอีกชั้น)
  //    เติม qtyExpected = จำนวนที่สั่งของสินค้านั้น → ให้ over/short มองเห็นได้ (ไม่ฮาร์ดบล็อก)
  const grn = await createGrn({
    warehouseId,
    poId,
    note: cleanStr(input.note),
    lines: rawLines.map((l) => ({
      productId: l.productId,
      qtyExpected: orderedByProduct.get(l.productId) ?? 0,
      qtyReceived: nonNegInt(l.qtyReceived),
      qtyDamaged: nonNegInt(l.qtyDamaged),
    })),
  });
  if (!grn.ok) return { ok: false, error: grn.error };

  // 2) ลงรับเข้า: คิดต้นทุน + ตัดสต๊อก + ดัน TRCloud (best-effort · ไม่ throw)
  const posted = await postGrn(grn.grnId);
  if (!posted.ok) return { ok: false, error: posted.error };

  // 3) คำนวณ "รับสะสมจริง" (ทุก GRN ของใบนี้ รวมใบที่เพิ่งสร้าง) เทียบ "สั่งทั้งหมด" ต่อสินค้า
  //    → รับครบทุกตัว = RECEIVED (ปิดใบ) · ยังไม่ครบ = PARTIAL (เปิดให้รับรอบถัดไปได้)
  const grnLines = await prisma.dcGoodsReceiptLine.findMany({
    where: { orgId, grn: { poId, orgId } },
    select: { productId: true, qtyReceived: true },
  });
  const receivedByProduct = new Map<string, number>();
  for (const gl of grnLines) {
    receivedByProduct.set(gl.productId, (receivedByProduct.get(gl.productId) ?? 0) + gl.qtyReceived);
  }
  // รับครบ = ทุกสินค้าที่สั่ง มียอดรับสะสม ≥ ยอดที่สั่ง
  const fullyReceived = [...orderedByProduct.entries()].every(
    ([pid, ordered]) => (receivedByProduct.get(pid) ?? 0) >= ordered,
  );
  const nextStatus = fullyReceived ? DcPoStatus.RECEIVED : DcPoStatus.PARTIAL;

  // เดินสถานะจากสถานะที่รับเข้าได้ (รวม PARTIAL → รับรอบ 2 แล้วครบ → ปิดใบ)
  await prisma.dcPurchaseOrder.updateMany({
    where: {
      id: poId,
      orgId,
      status: {
        in: [
          DcPoStatus.AT_WAREHOUSE,
          DcPoStatus.ARRIVED_TH,
          DcPoStatus.SHIPPED,
          DcPoStatus.ORDERED,
          DcPoStatus.PARTIAL,
        ],
      },
    },
    data: { status: nextStatus },
  });

  revalidate(poId);
  // สถานะ TRCloud จาก postGrn — ถ้า posted=false ฝั่ง UI จะโชว์แถบเหลือง "บัญชียังไม่เข้า · กดส่งซ้ำ"
  return {
    ok: true,
    grnId: grn.grnId,
    trcloudPosted: posted.trcloud.posted,
    trcloudReason: posted.trcloud.reason ?? posted.trcloud.error,
  };
}
