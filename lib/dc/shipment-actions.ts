"use server";

// DC คลังกลาง · ชิปเมนต์ (Shipment / freight + CBM) — server actions.
//
// ชิปเมนต์ = "เที่ยวขนของจากจีนมาไทย" 1 เที่ยว. มันถือ "ถังต้นทุนนำเข้า"
// (ค่าขนส่งจีน · ค่าขนส่งระหว่างประเทศ · ภาษีนำเข้า · ค่าชิปปิ้ง · ประกัน) ที่
// landed-cost engine จะหารเฉลี่ยลงสินค้าแต่ละชิ้นตาม CBM/มูลค่า ตอนรับเข้า (GRN).
//
// 🏗️ ความปลอดภัยของสถานะ (state machine) — mirror PO:
//   PREPARING → IN_TRANSIT → ARRIVED → RECEIVED
//   แก้รายการ (เพิ่ม/ลบบรรทัด) ได้เฉพาะตอน PREPARING เท่านั้น (กันแก้ของที่ส่งแล้ว)
//   ทุก transition ใช้ updateMany WHERE {id, orgId} → กดซ้ำ/แข่งกัน = idempotent
//
// การ์ดสิทธิ์: ทุก action = canDcManage (ผู้จัดการขึ้นไป) · org-scope ทุก query.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { shipmentCode } from "@/lib/dc/codes";
import { DcShipmentMode, DcShipmentStatus } from "@/lib/generated/prisma/enums";

const LIST_PATH = "/dc/office/shipments";

export type ShipmentActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type ShipmentLineInput = {
  productId: string;
  qty: number;
  cbm?: number | null;
};

export type CreateShipmentInput = {
  poId?: string | null;
  mode: DcShipmentMode;
  trackingNo?: string | null;
  fxRate?: number | null;
  fxDate?: string | null; // ISO date (yyyy-mm-dd) จากฟอร์ม
  etd?: string | null;
  eta?: string | null;
  note?: string | null;
  lines?: ShipmentLineInput[];
};

export type UpdateShipmentCostsInput = {
  chinaFreightThbSatang?: number;
  intlFreightThbSatang?: number;
  dutyThbSatang?: number;
  brokerThbSatang?: number;
  insuranceThbSatang?: number;
  fxRate?: number | null;
  fxDate?: string | null;
};

// ── helpers ──────────────────────────────────────────────────

async function requireManager(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการชิปเมนต์" };
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

/** จำนวนเต็มไม่ติดลบ (สำหรับช่อง satang) */
function nonNegInt(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v) || v < 0) return 0;
  return Math.round(v);
}

function dec(v: number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

/** แปลง ISO/yyyy-mm-dd → Date หรือ null (กัน Invalid Date) */
function parseDate(v: string | null | undefined): Date | null {
  const s = cleanStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function revalidate(id?: string) {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

/** ยืนยันว่าสินค้าทุกบรรทัดเป็นของ org นี้จริง (กันอ้าง productId ข้ามองค์กร). */
async function assertProductsInOrg(orgId: string, productIds: string[]): Promise<boolean> {
  if (productIds.length === 0) return true;
  const owned = await prisma.dcProduct.findMany({
    where: { id: { in: productIds }, orgId },
    select: { id: true },
  });
  return owned.length === productIds.length;
}

/** ผลรวม CBM ของทุกบรรทัด (null ถ้าทุกบรรทัดไม่มี CBM). */
function sumCbm(lines: { cbm?: number | null }[]): number | null {
  let total = 0;
  let any = false;
  for (const l of lines) {
    const c = posNum(l.cbm);
    if (c != null) {
      total += c;
      any = true;
    }
  }
  return any ? total : null;
}

// ── สร้างชิปเมนต์ (PREPARING) ─────────────────────────────────

export async function createShipment(
  input: CreateShipmentInput,
): Promise<ShipmentActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const poId = cleanStr(input.poId);
  const mode = input.mode === DcShipmentMode.TRUCK ? DcShipmentMode.TRUCK : DcShipmentMode.SEA;
  const fxRate = posNum(input.fxRate);
  const fxDate = parseDate(input.fxDate);

  // ถ้าระบุ PO → ยืนยันว่า PO เป็นของ org + (ถ้าไม่มีบรรทัดส่งมา) pre-fill จาก PO lines
  let lines: ShipmentLineInput[] = (input.lines ?? []).filter((l) => cleanStr(l.productId));

  if (poId) {
    const po = await prisma.dcPurchaseOrder.findFirst({
      where: { id: poId, orgId },
      select: { id: true },
    });
    if (!po) return { ok: false, error: "ไม่พบใบสั่งซื้อนี้ในองค์กรของคุณ" };

    if (lines.length === 0) {
      // pre-fill: cbm = cbmPerUnit × qty (ถ้ามี cbmPerUnit)
      const poLines = await prisma.dcPurchaseLine.findMany({
        where: { orgId, poId },
        select: { productId: true, qty: true, cbmPerUnit: true },
      });
      lines = poLines.map((pl) => ({
        productId: pl.productId,
        qty: pl.qty,
        cbm: pl.cbmPerUnit != null ? Number(pl.cbmPerUnit) * pl.qty : null,
      }));
    }
  }

  if (lines.length === 0) {
    return { ok: false, error: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ" };
  }

  const productIds = [...new Set(lines.map((l) => l.productId))];
  if (!(await assertProductsInOrg(orgId, productIds))) {
    return { ok: false, error: "มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ" };
  }

  const cbmTotal = sumCbm(lines);

  try {
    const ship = await prisma.dcShipment.create({
      data: {
        orgId,
        poId,
        shipmentCode: shipmentCode(),
        trackingNo: cleanStr(input.trackingNo),
        mode,
        status: DcShipmentStatus.PREPARING,
        cbmTotal: cbmTotal != null ? dec(cbmTotal) : null,
        fxRate: fxRate != null ? dec(fxRate) : null,
        fxDate,
        etd: parseDate(input.etd),
        eta: parseDate(input.eta),
        note: cleanStr(input.note),
        lines: {
          create: lines.map((l) => ({
            orgId,
            productId: l.productId,
            qty: Math.max(1, Math.trunc(l.qty || 0)),
            cbm: posNum(l.cbm) != null ? dec(posNum(l.cbm)!) : null,
          })),
        },
      },
      select: { id: true },
    });
    revalidate(ship.id);
    return { ok: true, id: ship.id };
  } catch {
    return { ok: false, error: "สร้างชิปเมนต์ไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── ค่าขนส่ง/ต้นทุนนำเข้า (ถังต้นทุนที่ landed-cost ใช้) ──────────

export async function updateShipmentCosts(
  id: string,
  input: UpdateShipmentCostsInput,
): Promise<ShipmentActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const ship = await prisma.dcShipment.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!ship) return { ok: false, error: "ไม่พบชิปเมนต์นี้ในองค์กรของคุณ" };

  const fxRate = posNum(input.fxRate);
  const fxDate = parseDate(input.fxDate);

  try {
    await prisma.dcShipment.update({
      where: { id },
      data: {
        chinaFreightThbSatang: nonNegInt(input.chinaFreightThbSatang),
        intlFreightThbSatang: nonNegInt(input.intlFreightThbSatang),
        dutyThbSatang: nonNegInt(input.dutyThbSatang),
        brokerThbSatang: nonNegInt(input.brokerThbSatang),
        insuranceThbSatang: nonNegInt(input.insuranceThbSatang),
        fxRate: fxRate != null ? dec(fxRate) : null,
        fxDate,
      },
    });
    revalidate(id);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "บันทึกค่าขนส่ง/ต้นทุนนำเข้าไม่สำเร็จ ลองอีกครั้ง" };
  }
}

// ── เปลี่ยนสถานะ (state machine · idempotent ด้วย WHERE) ─────────

const ALLOWED_STATUS: DcShipmentStatus[] = [
  DcShipmentStatus.PREPARING,
  DcShipmentStatus.IN_TRANSIT,
  DcShipmentStatus.ARRIVED,
  DcShipmentStatus.RECEIVED,
];

// ลำดับเดินหน้าเท่านั้น (mirror PO state-machine) — กันถอยกลับ (เช่น RECEIVED→PREPARING
// แล้วปลดล็อกแก้รายการหลังต้นทุนคิดแล้ว) และกันข้ามขั้น. แต่ละสถานะปลายทาง
// อนุญาตจาก "สถานะก่อนหน้าที่ถูกต้อง" ตัวเดียวเท่านั้น. RECEIVED = ปลายทาง ไม่มีทางออก.
const PREV_STATUS: Partial<Record<DcShipmentStatus, DcShipmentStatus>> = {
  [DcShipmentStatus.IN_TRANSIT]: DcShipmentStatus.PREPARING,
  [DcShipmentStatus.ARRIVED]: DcShipmentStatus.IN_TRANSIT,
  [DcShipmentStatus.RECEIVED]: DcShipmentStatus.ARRIVED,
};

export async function setShipmentStatus(
  id: string,
  status: DcShipmentStatus,
): Promise<ShipmentActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  if (!ALLOWED_STATUS.includes(status)) {
    return { ok: false, error: "สถานะไม่ถูกต้อง" };
  }

  // PREPARING ไม่มีสถานะก่อนหน้า → ไม่ใช่ปลายทางที่ตั้งได้ (เริ่มที่ PREPARING ตอนสร้าง)
  const prev = PREV_STATUS[status];
  if (!prev) {
    return { ok: false, error: "เปลี่ยนสถานะไม่ได้ (ลำดับไม่ถูกต้อง หรือเปลี่ยนไปแล้ว)" };
  }

  // gate ด้วยสถานะก่อนหน้าที่ถูกต้องเท่านั้น → ถอยกลับ/ข้ามขั้น/แข่งกัน = count===0 = ปฏิเสธ
  const res = await prisma.dcShipment.updateMany({
    where: { id, orgId, status: prev },
    data: { status },
  });
  if (res.count === 0) {
    return { ok: false, error: "เปลี่ยนสถานะไม่ได้ (ลำดับไม่ถูกต้อง หรือเปลี่ยนไปแล้ว)" };
  }
  revalidate(id);
  return { ok: true, id };
}

// ── เพิ่ม/ลบ บรรทัด (เฉพาะ PREPARING) ────────────────────────────

/** อ่านชิปเมนต์ + ตรวจ org + ตรวจว่าแก้ได้ (PREPARING). */
async function loadEditableShipment(
  id: string,
  orgId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const ship = await prisma.dcShipment.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!ship) return { ok: false, error: "ไม่พบชิปเมนต์นี้ในองค์กรของคุณ" };
  if (ship.status !== DcShipmentStatus.PREPARING) {
    return { ok: false, error: "แก้ไขรายการได้เฉพาะชิปเมนต์ที่ยัง 'เตรียมส่ง' เท่านั้น" };
  }
  return { ok: true };
}

/** คำนวณ cbmTotal ใหม่จากบรรทัดทั้งหมดในชิปเมนต์ แล้วบันทึก. */
async function recomputeCbmTotal(shipmentId: string, orgId: string): Promise<void> {
  const lines = await prisma.dcShipmentLine.findMany({
    where: { shipmentId, orgId },
    select: { cbm: true },
  });
  const total = sumCbm(lines.map((l) => ({ cbm: l.cbm != null ? Number(l.cbm) : null })));
  await prisma.dcShipment.update({
    where: { id: shipmentId },
    data: { cbmTotal: total != null ? dec(total) : null },
  });
}

export async function addShipmentLine(
  shipmentId: string,
  line: ShipmentLineInput,
): Promise<ShipmentActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const editable = await loadEditableShipment(shipmentId, orgId);
  if (!editable.ok) return editable;

  if (!cleanStr(line.productId)) return { ok: false, error: "กรุณาเลือกสินค้า" };
  if (!(await assertProductsInOrg(orgId, [line.productId]))) {
    return { ok: false, error: "ไม่พบสินค้านี้ในองค์กรของคุณ" };
  }

  try {
    await prisma.dcShipmentLine.create({
      data: {
        orgId,
        shipmentId,
        productId: line.productId,
        qty: Math.max(1, Math.trunc(line.qty || 0)),
        cbm: posNum(line.cbm) != null ? dec(posNum(line.cbm)!) : null,
      },
    });
    await recomputeCbmTotal(shipmentId, orgId);
    revalidate(shipmentId);
    return { ok: true, id: shipmentId };
  } catch {
    return { ok: false, error: "เพิ่มรายการไม่สำเร็จ ลองอีกครั้ง" };
  }
}

export async function removeShipmentLine(
  shipmentId: string,
  lineId: string,
): Promise<ShipmentActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const { orgId } = g;

  const editable = await loadEditableShipment(shipmentId, orgId);
  if (!editable.ok) return editable;

  const res = await prisma.dcShipmentLine.deleteMany({
    where: { id: lineId, shipmentId, orgId },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบรายการนี้" };
  await recomputeCbmTotal(shipmentId, orgId);
  revalidate(shipmentId);
  return { ok: true, id: shipmentId };
}
