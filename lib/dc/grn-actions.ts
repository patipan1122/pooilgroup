"use server";

// DC คลังกลาง · ใบรับสินค้า (Goods Receipt / GRN) — server actions.
//
// GRN = "ของมาถึงคลังจริง" 1 ใบ. มันคือจุดที่ระบบ:
//   1) บันทึกว่ารับเข้าจริงกี่ชิ้น (รับครบ/ขาด/เกิน/เสียหาย)
//   2) เรียก bridge processGrnFull → คิดต้นทุนนำเข้า (landed cost) ต่อชิ้น +
//      ตัดสต๊อกเข้า + ดันเข้า TRCloud (best-effort)
//
// 🏗️ Architecture (RULE I):
//   • Race/idempotency: processGrnFull (bridge) idempotent อยู่แล้ว (cost layer +
//     stock movement กันซ้ำด้วย sourceKey). ที่นี่เพิ่มด่าน "โพสต์ได้ครั้งเดียว"
//     ด้วยการเช็ค postStatus ก่อน — กันกดปุ่มรัวซ้ำ.
//   • Data consistency: สร้าง GRN + lines ใน create เดียว (nested) = atomic.
//   • Org-scope: ทุก query กรอง orgId + ยืนยัน warehouse/po/shipment เป็นของ org.
//
// การ์ดสิทธิ์: ทุก action = canDcManage (ผู้จัดการขึ้นไป).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { grnCode } from "@/lib/dc/codes";
import { DcPostStatus } from "@/lib/generated/prisma/enums";
import {
  processGrnFull,
  pushGrnToTrcloud,
  type ProcessGrnFullResult,
  type PushGrnResult,
} from "@/lib/dc/trcloud-bridge";

const LIST_PATH = "/dc/office/receipts";

export type GrnCreateResult =
  | { ok: true; grnId: string }
  | { ok: false; error: string };

export type GrnLineInput = {
  productId: string;
  qtyExpected?: number | null;
  qtyReceived: number;
  qtyDamaged?: number | null;
  note?: string | null;
};

export type CreateGrnInput = {
  warehouseId: string;
  shipmentId?: string | null;
  poId?: string | null;
  note?: string | null;
  lines: GrnLineInput[];
};

// ── helpers ──────────────────────────────────────────────────

async function requireManager(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์รับสินค้าเข้าคลัง" };
  }
  return { ok: true, orgId: session.user.org_id, userId: session.user.id };
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** จำนวนเต็มไม่ติดลบ (รับ/เสียหาย/คาดหวัง อาจเป็น 0 ได้). */
function nonNegInt(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

function revalidate(id?: string) {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

// ── สร้างใบรับสินค้า (PENDING — ยังไม่คิดต้นทุน/ตัดสต๊อก) ──────────

export async function createGrn(input: CreateGrnInput): Promise<GrnCreateResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId, userId } = g;

  const warehouseId = cleanStr(input.warehouseId);
  if (!warehouseId) return { ok: false, error: "กรุณาเลือกคลังปลายทาง" };

  const shipmentId = cleanStr(input.shipmentId);
  const poId = cleanStr(input.poId);

  // คลังต้องเป็นของ org นี้
  const wh = await prisma.dcWarehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { id: true },
  });
  if (!wh) return { ok: false, error: "ไม่พบคลังนี้ในองค์กรของคุณ" };

  // ชิปเมนต์/PO (ถ้าระบุ) ต้องเป็นของ org นี้
  if (shipmentId) {
    const s = await prisma.dcShipment.findFirst({
      where: { id: shipmentId, orgId },
      select: { id: true },
    });
    if (!s) return { ok: false, error: "ไม่พบชิปเมนต์นี้ในองค์กรของคุณ" };
  }
  if (poId) {
    const p = await prisma.dcPurchaseOrder.findFirst({
      where: { id: poId, orgId },
      select: { id: true },
    });
    if (!p) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };
  }

  const rawLines = (input.lines ?? []).filter((l) => cleanStr(l.productId));
  if (rawLines.length === 0) {
    return { ok: false, error: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ" };
  }

  // ยืนยันสินค้าทุกบรรทัดเป็นของ org
  const productIds = [...new Set(rawLines.map((l) => l.productId))];
  const owned = await prisma.dcProduct.findMany({
    where: { id: { in: productIds }, orgId },
    select: { id: true },
  });
  if (owned.length !== productIds.length) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  // รวมบรรทัดที่เป็นสินค้าตัวเดียวกัน (productId ซ้ำ) ให้เหลือ "1 สินค้า = 1 บรรทัด GRN"
  // → 1 cost layer ต่อสินค้า. ถ้าไม่รวม: bridge map ต้นทุน by-product ทับกัน → cost layer
  //   ของบรรทัดหลังกลืนบรรทัดแรก (สต๊อก/ต้นทุนคลาดเคลื่อน). รวม qty + ใช้โน้ตแรกที่มี.
  const mergedMap = new Map<
    string,
    { productId: string; qtyExpected: number; qtyReceived: number; qtyDamaged: number; note: string | null }
  >();
  for (const l of rawLines) {
    const prev = mergedMap.get(l.productId);
    if (prev) {
      prev.qtyExpected += nonNegInt(l.qtyExpected);
      prev.qtyReceived += nonNegInt(l.qtyReceived);
      prev.qtyDamaged += nonNegInt(l.qtyDamaged);
      prev.note = prev.note ?? cleanStr(l.note);
    } else {
      mergedMap.set(l.productId, {
        productId: l.productId,
        qtyExpected: nonNegInt(l.qtyExpected),
        qtyReceived: nonNegInt(l.qtyReceived),
        qtyDamaged: nonNegInt(l.qtyDamaged),
        note: cleanStr(l.note),
      });
    }
  }
  const mergedLines = [...mergedMap.values()];

  try {
    const grn = await prisma.dcGoodsReceipt.create({
      data: {
        orgId,
        grnCode: grnCode(),
        warehouseId,
        shipmentId,
        poId,
        status: "RECEIVED",
        postStatus: DcPostStatus.PENDING,
        note: cleanStr(input.note),
        receivedByUserId: userId,
        lines: {
          create: mergedLines.map((l) => ({
            orgId,
            productId: l.productId,
            qtyExpected: l.qtyExpected,
            qtyReceived: l.qtyReceived,
            qtyDamaged: l.qtyDamaged,
            note: l.note,
          })),
        },
      },
      select: { id: true },
    });
    revalidate(grn.id);
    return { ok: true, grnId: grn.id };
  } catch {
    return { ok: false, error: "สร้างใบรับสินค้าไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── ลงรับเข้า + คิดต้นทุน + ดันเข้า TRCloud ───────────────────────

export type PostGrnResult =
  | (ProcessGrnFullResult & { ok: true })
  | { ok: false; error: string };

/**
 * คิดต้นทุนนำเข้า + ตัดสต๊อกเข้า + ดัน TRCloud. เรียก bridge processGrnFull.
 * ด่านกันโพสต์ซ้ำ: ถ้า GRN โพสต์สำเร็จไปแล้ว (POSTED) → ไม่ทำซ้ำ.
 * (ส่วน PENDING/FAILED เรียกซ้ำได้ — bridge idempotent: cost layer/stock จะไม่ซ้ำ,
 *  มีผลแค่ลอง push TRCloud ใหม่ ซึ่งคือสิ่งที่ต้องการตอน retry).
 */
export async function postGrn(grnId: string): Promise<PostGrnResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const grn = await prisma.dcGoodsReceipt.findFirst({
    where: { id: grnId, orgId },
    select: { id: true, postStatus: true },
  });
  if (!grn) return { ok: false, error: "ไม่พบใบรับสินค้านี้ในองค์กรของคุณ" };

  if (grn.postStatus === DcPostStatus.POSTED) {
    return { ok: false, error: "ใบรับสินค้านี้ลงบัญชี + เข้า TRCloud เรียบร้อยแล้ว" };
  }

  const result = await processGrnFull(grnId);
  revalidate(grnId);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "ลงรับเข้า/คิดต้นทุนไม่สำเร็จ" };
  }
  return { ...result, ok: true };
}

// ── ดันเข้า TRCloud อีกครั้ง (retry) ──────────────────────────────

export type RetryTrcloudResult =
  | (PushGrnResult & { ok: boolean })
  | { ok: false; error: string };

/**
 * ลองดัน GRN เข้า TRCloud ใหม่ (ใช้ตอน postStatus = PENDING/FAILED).
 * ต้นทุน + สต๊อกถูกคิด/ตัดไปแล้วจาก postGrn รอบแรก — ปุ่มนี้แค่ retry การส่ง.
 * pushGrnToTrcloud เป็น best-effort + idempotent (search-by-reference ใน TRCloud).
 */
export async function retryTrcloud(grnId: string): Promise<RetryTrcloudResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const grn = await prisma.dcGoodsReceipt.findFirst({
    where: { id: grnId, orgId },
    select: { id: true, postStatus: true },
  });
  if (!grn) return { ok: false, error: "ไม่พบใบรับสินค้านี้ในองค์กรของคุณ" };

  if (grn.postStatus === DcPostStatus.POSTED) {
    return { ok: false, error: "ใบรับสินค้านี้เข้า TRCloud เรียบร้อยแล้ว" };
  }

  const res = await pushGrnToTrcloud(grnId);
  revalidate(grnId);
  return { ...res };
}
