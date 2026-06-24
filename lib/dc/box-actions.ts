"use server";

// DC คลังกลาง · "กล่อง/พัสดุ" ของใบสั่งซื้อ — server actions.
//
// กล่อง = DcShipment 1 แถว ที่ผูกกับใบสั่งซื้อ (PO) 1 ใบ (1 กล่อง = 1 shipment).
// แต่ละกล่องถือ: เลขพัสดุ (tracking) · วิธีขนส่ง (รถ/เรือ) · ขนาดกล่อง (กว้าง×ยาว×สูง ซม.)
//   → คิดปริมาตร CBM อัตโนมัติ · และ "ของในกล่อง" = DcShipmentLine (สินค้า + จำนวน).
//
// 🏗️ ความปลอดภัย (RULE I):
//   • Org-scope: ทุก query กรอง orgId + ยืนยัน PO/สินค้าเป็นของ org ก่อน insert.
//   • Idempotency: setBoxContents ลบของเดิมแล้วใส่ใหม่ในทรานแซกชันเดียว (replace = no-op
//     ถ้าส่งของเดิมซ้ำ) · removeBox กันลบกล่องของใบที่ "รับเข้าแล้ว" (RECEIVED).
//   • Data consistency: สร้างกล่อง + ของในกล่อง ใน create เดียว (nested) = atomic.
//
// การ์ดสิทธิ์: ทุก action = canDcManage (ผู้จัดการขึ้นไป).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { shipmentCode } from "@/lib/dc/codes";
import { DcShipmentMode, DcShipmentStatus, DcPoStatus } from "@/lib/generated/prisma/enums";

const PO_PATH = "/dc/office/purchasing";

export type BoxActionResult =
  | { ok: true; boxId: string }
  | { ok: false; error: string };

export type BoxContentInput = {
  productId: string;
  qty: number;
};

export type AddBoxInput = {
  poId: string;
  trackingNo?: string | null;
  mode: "TRUCK" | "SEA";
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  note?: string | null;
  contents: BoxContentInput[];
};

export type UpdateBoxInput = {
  trackingNo?: string | null;
  mode?: "TRUCK" | "SEA";
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  note?: string | null;
};

// ── helpers ──────────────────────────────────────────────────

/** Guard: login + canDcManage. */
async function requireManager(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการกล่อง/พัสดุ" };
  }
  return { ok: true, orgId: session.user.org_id, userId: session.user.id };
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** เลขที่ใช้ได้ (>0) หรือ null */
function posNum(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function dec(v: number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function normMode(m: "TRUCK" | "SEA" | undefined): DcShipmentMode {
  return m === "TRUCK" ? DcShipmentMode.TRUCK : DcShipmentMode.SEA;
}

/** ปริมาตรลูกบาศก์เมตร จากขนาดกล่อง ซม. (cm³ → m³ หาร 1e6). null ถ้าขนาดไม่ครบ. */
function boxCbm(
  l: number | null,
  w: number | null,
  h: number | null,
): number | null {
  if (l == null || w == null || h == null) return null;
  return (l * w * h) / 1_000_000;
}

function revalidate(poId: string) {
  revalidatePath(`${PO_PATH}/${poId}`);
}

/** ยืนยันว่าสินค้าทุกตัวเป็นของ org นี้ (กันอ้าง productId ข้ามองค์กร). */
async function assertProductsInOrg(orgId: string, productIds: string[]): Promise<boolean> {
  if (productIds.length === 0) return true;
  const owned = await prisma.dcProduct.findMany({
    where: { id: { in: productIds }, orgId },
    select: { id: true },
  });
  return owned.length === productIds.length;
}

/** โหลดกล่อง + ตรวจว่าเป็นของ org + คืน poId/สถานะใบ. */
async function loadBox(
  boxId: string,
  orgId: string,
): Promise<
  | { ok: true; poId: string | null; poStatus: DcPoStatus | null }
  | { ok: false; error: string }
> {
  const box = await prisma.dcShipment.findFirst({
    where: { id: boxId, orgId },
    select: { id: true, poId: true, po: { select: { status: true } } },
  });
  if (!box) return { ok: false, error: "ไม่พบกล่อง/พัสดุนี้ในองค์กรของคุณ" };
  return { ok: true, poId: box.poId, poStatus: box.po?.status ?? null };
}

// ── เพิ่มกล่อง (ผูกกับใบสั่งซื้อ) ───────────────────────────────

export async function addBox(input: AddBoxInput): Promise<BoxActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const poId = cleanStr(input.poId);
  if (!poId) return { ok: false, error: "ไม่พบใบสั่งซื้อ" };

  // ใบสั่งซื้อต้องเป็นของ org นี้
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id: poId, orgId },
    select: { id: true },
  });
  if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

  const contents = (input.contents ?? []).filter((c) => cleanStr(c.productId));
  if (contents.length === 0) {
    return { ok: false, error: "กรุณาใส่สินค้าในกล่องอย่างน้อย 1 รายการ" };
  }

  const productIds = [...new Set(contents.map((c) => c.productId))];
  if (!(await assertProductsInOrg(orgId, productIds))) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  const l = posNum(input.lengthCm);
  const w = posNum(input.widthCm);
  const h = posNum(input.heightCm);
  const cbm = boxCbm(l, w, h);

  try {
    const box = await prisma.dcShipment.create({
      data: {
        orgId,
        poId,
        shipmentCode: shipmentCode(),
        trackingNo: cleanStr(input.trackingNo),
        mode: normMode(input.mode),
        status: DcShipmentStatus.PREPARING,
        lengthCm: l != null ? dec(l) : null,
        widthCm: w != null ? dec(w) : null,
        heightCm: h != null ? dec(h) : null,
        cbmTotal: cbm != null ? dec(cbm) : null,
        note: cleanStr(input.note),
        lines: {
          create: contents.map((c) => ({
            orgId,
            productId: c.productId,
            qty: Math.max(1, Math.trunc(c.qty || 0)),
          })),
        },
      },
      select: { id: true },
    });
    revalidate(poId);
    return { ok: true, boxId: box.id };
  } catch {
    return { ok: false, error: "เพิ่มกล่อง/พัสดุไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── แก้ไขกล่อง (เลขพัสดุ/วิธีขนส่ง/ขนาด → คิด CBM ใหม่) ─────────────

export async function updateBox(
  boxId: string,
  input: UpdateBoxInput,
): Promise<BoxActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const box = await loadBox(boxId, orgId);
  if (!box.ok) return box;

  const l = posNum(input.lengthCm);
  const w = posNum(input.widthCm);
  const h = posNum(input.heightCm);
  const cbm = boxCbm(l, w, h);

  try {
    await prisma.dcShipment.update({
      where: { id: boxId },
      data: {
        trackingNo: cleanStr(input.trackingNo),
        ...(input.mode != null ? { mode: normMode(input.mode) } : {}),
        lengthCm: l != null ? dec(l) : null,
        widthCm: w != null ? dec(w) : null,
        heightCm: h != null ? dec(h) : null,
        cbmTotal: cbm != null ? dec(cbm) : null,
        note: cleanStr(input.note),
      },
    });
    if (box.poId) revalidate(box.poId);
    return { ok: true, boxId };
  } catch {
    return { ok: false, error: "แก้ไขกล่อง/พัสดุไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── ลบกล่อง (ห้ามลบถ้าใบรับเข้าแล้ว) ─────────────────────────────

export async function removeBox(boxId: string): Promise<BoxActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const box = await loadBox(boxId, orgId);
  if (!box.ok) return box;
  if (box.poStatus === DcPoStatus.RECEIVED) {
    return { ok: false, error: "ลบกล่องไม่ได้ — ใบสั่งซื้อนี้รับสินค้าเข้าคลังแล้ว" };
  }

  // ลบเฉพาะกล่องของ org นี้ (lines cascade ตาม schema) — scope กันลบข้ามองค์กร
  const res = await prisma.dcShipment.deleteMany({
    where: { id: boxId, orgId },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบกล่อง/พัสดุนี้" };
  if (box.poId) revalidate(box.poId);
  return { ok: true, boxId };
}

// ── ตั้งของในกล่อง (แทนที่ทั้งหมด) ──────────────────────────────

export async function setBoxContents(
  boxId: string,
  contents: BoxContentInput[],
): Promise<BoxActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const box = await loadBox(boxId, orgId);
  if (!box.ok) return box;
  if (box.poStatus === DcPoStatus.RECEIVED) {
    return { ok: false, error: "แก้ของในกล่องไม่ได้ — ใบสั่งซื้อนี้รับสินค้าเข้าคลังแล้ว" };
  }

  const clean = (contents ?? []).filter((c) => cleanStr(c.productId));
  if (clean.length === 0) {
    return { ok: false, error: "กรุณาใส่สินค้าในกล่องอย่างน้อย 1 รายการ" };
  }

  const productIds = [...new Set(clean.map((c) => c.productId))];
  if (!(await assertProductsInOrg(orgId, productIds))) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  try {
    // แทนที่ของในกล่องทั้งหมดในทรานแซกชันเดียว (atomic · ไม่หลงเหลือของเก่า)
    await prisma.$transaction([
      prisma.dcShipmentLine.deleteMany({ where: { shipmentId: boxId, orgId } }),
      prisma.dcShipmentLine.createMany({
        data: clean.map((c) => ({
          orgId,
          shipmentId: boxId,
          productId: c.productId,
          qty: Math.max(1, Math.trunc(c.qty || 0)),
        })),
      }),
    ]);
    if (box.poId) revalidate(box.poId);
    return { ok: true, boxId };
  } catch {
    return { ok: false, error: "ตั้งของในกล่องไม่สำเร็จ ลองอีกครั้ง" };
  }
}
