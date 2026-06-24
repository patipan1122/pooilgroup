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
import { canDcManage } from "@/lib/dc/role-guard";
import { poCode } from "@/lib/dc/codes";
import { DcPoStatus } from "@/lib/generated/prisma/enums";

const LIST_PATH = "/dc/office/purchasing";

export type PoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type PoLineInput = {
  productId: string;
  qty: number;
  unitPriceCny: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  photoR2Key?: string | null;
  note?: string | null;
};

export type CreatePoInput = {
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

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** เลขทศนิยมที่ใช้ได้ (>0) หรือ null */
function posNum(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/** ปริมาตรลูกบาศก์เมตร/ชิ้น จากขนาด ซม. (cm³ → m³ หาร 1e6). คืน null ถ้าขนาดไม่ครบ. */
function computeCbm(
  l: number | null,
  w: number | null,
  h: number | null,
): number | null {
  if (l == null || w == null || h == null) return null;
  return (l * w * h) / 1_000_000;
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

/** แปลง 1 บรรทัด input → data สำหรับ create (คิด CBM + THB ให้). productId ต้องเป็นของ org. */
function buildLineData(
  orgId: string,
  line: PoLineInput,
  fxRate: number | null,
) {
  const qty = Math.max(1, Math.trunc(line.qty || 0));
  const cny = posNum(line.unitPriceCny) ?? 0;
  const l = posNum(line.lengthCm);
  const w = posNum(line.widthCm);
  const h = posNum(line.heightCm);
  const cbm = computeCbm(l, w, h);
  const thb = fxRate != null ? cny * fxRate : null;

  return {
    orgId,
    productId: line.productId,
    qty,
    unitPriceCny: dec(cny),
    unitPriceThb: thb != null ? dec(thb) : null,
    photoR2Key: cleanStr(line.photoR2Key),
    lengthCm: l != null ? dec(l) : null,
    widthCm: w != null ? dec(w) : null,
    heightCm: h != null ? dec(h) : null,
    cbmPerUnit: cbm != null ? dec(cbm) : null,
    note: cleanStr(line.note),
  };
}

// ── สร้างใบ (DRAFT) ──────────────────────────────────────────

export async function createPo(input: CreatePoInput): Promise<PoActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const supplierId = cleanStr(input.supplierId);
  const warehouseId = cleanStr(input.warehouseId);
  const fxRate = posNum(input.fxRate);

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

  try {
    const po = await prisma.dcPurchaseOrder.create({
      data: {
        orgId,
        poCode: poCode(),
        supplierId: supplierId,
        warehouseId: warehouseId,
        status: DcPoStatus.DRAFT,
        currency: "CNY",
        fxRate: fxRate != null ? dec(fxRate) : null,
        note: cleanStr(input.note),
        createdByUserId: userId,
        lines: {
          create: lines.map((l) => buildLineData(orgId, l, fxRate)),
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
    select: { id: true, status: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  if (po.status !== DcPoStatus.DRAFT) {
    return { ok: false, error: "แก้ไขได้เฉพาะใบที่ยังเป็นร่าง (DRAFT)" };
  }

  const supplierId = cleanStr(input.supplierId);
  const warehouseId = cleanStr(input.warehouseId);
  const fxRate = posNum(input.fxRate);

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
        const thb = fxRate != null ? Number(ln.unitPriceCny) * fxRate : null;
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
    select: { id: true, status: true, fxRate: true },
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
      data: { poId, ...buildLineData(orgId, line, fxRate) },
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
