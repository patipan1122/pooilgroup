// DC · ตัวโหลดข้อมูลเอกสาร → รูป PNG (ใช้ใน route `/image`).
// สร้าง DocImageInput (โครงเดียวกับ props ของ <DcPrintDoc>) สำหรับ PO / ใบโอน / ใบนับ.
// gate สิทธิ์ + scope orgId + คลังที่เข้าถึงได้ ครบเหมือนหน้า /print ทุกอัน — ห้ามหลุด.
//
// ★ NOT "use server": นี่คือ helper ธรรมดา (เรียกจาก route handler ที่ตั้ง runtime nodejs แล้ว)
//   — return DocImageInput | null (null = ไม่พบ/ไม่มีสิทธิ์ → route ตอบ 404).

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { requireDcManager, requireDcFloor } from "@/lib/dc/role-guard";
import { getAllowedWarehouses } from "@/lib/dc/access";
import { getCountSheet } from "@/lib/dc/count-actions";
import { PO_STATUS_LABEL, PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { DcMoveKind } from "@/lib/generated/prisma/enums";
import type { DocImageInput } from "@/lib/dc/doc-image";

// ── format helpers (mirror หน้า print) ──────────────────────────
function money(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function n0(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
function longDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "—";
}
function longDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
function varianceText(v: number): string {
  if (v === 0) return "ตรง";
  return v > 0 ? `+${n0(v)} เกิน` : `${n0(v)} ขาด`;
}

const TRANSFER_STATUS_TH: Record<string, string> = {
  DISPATCHED: "ส่งออกแล้ว",
  IN_TRANSIT: "กำลังส่ง",
  CONFIRMED: "รับแล้ว",
  AUTO_UNVERIFIED: "รับ (ยังไม่ยืนยัน)",
  CANCELLED: "ยกเลิก",
};

async function loadOrg(orgId: string): Promise<{ name: string; logoUrl: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logoUrl: true } });
  return { name: org?.name ?? "บริษัท", logoUrl: org?.logoUrl ?? null };
}

// ════════════════════════════════════════════════════════════════════
// ใบสั่งซื้อ (PO)
// ════════════════════════════════════════════════════════════════════
export async function buildPoDocImage(id: string): Promise<DocImageInput | null> {
  const session = await requireSession();
  requireDcManager(session.user.role);
  const orgId = session.user.org_id;

  const [po, org, allowed] = await Promise.all([
    prisma.dcPurchaseOrder.findFirst({
      where: { id, orgId },
      select: {
        poCode: true, status: true, origin: true, fxRate: true,
        orderedAt: true, createdAt: true, note: true, warehouseId: true,
        supplier: { select: { name: true } },
        lines: {
          orderBy: { id: "asc" },
          select: { qty: true, unitPriceCny: true, product: { select: { name: true, sku: true } } },
        },
      },
    }),
    loadOrg(orgId),
    getAllowedWarehouses(session),
  ]);
  if (!po) return null;

  const isChina = po.origin === "CHINA";
  const sym = isChina ? "¥" : "฿";
  const fx = po.fxRate != null ? Number(po.fxRate) : null;
  const warehouseName = allowed.find((w) => w.id === po.warehouseId)?.name ?? "—";

  let sum = 0;
  const rows = po.lines.map((l) => {
    const price = Number(l.unitPriceCny);
    const lineTotal = l.qty * price;
    sum += lineTotal;
    const nameSku = `${l.product?.name ?? "—"}${l.product?.sku ? ` · ${l.product.sku}` : ""}`;
    return {
      cells: {
        name: nameSku,
        qty: money(l.qty, 0),
        price: `${sym}${money(price)}`,
        total: `${sym}${money(lineTotal)}`,
      },
    };
  });
  const thb = isChina && fx != null ? sum * fx : null;

  return {
    org,
    docTitle: "ใบสั่งซื้อ",
    docTitleEn: "Purchase Order",
    code: po.poCode,
    filename: `PO-${po.poCode}`,
    headerRight: [
      { label: "วันที่สั่ง", value: longDate(po.orderedAt ?? po.createdAt) },
      { label: "สถานะ", value: PO_STATUS_LABEL[po.status] ?? po.status },
    ],
    metaLeft: [
      { label: "ผู้ขาย", value: po.supplier?.name ?? "— ไม่ระบุ —" },
      { label: "คลังปลายทาง", value: warehouseName },
    ],
    metaRight: [
      { label: "ประเภท", value: PO_ORIGIN_LABEL[po.origin] ?? po.origin },
      ...(isChina && fx != null ? [{ label: "เรต ฿/¥", value: money(fx, 4) }] : []),
    ],
    columns: [
      { key: "name", header: "สินค้า", flex: 5, align: "left" },
      { key: "qty", header: "จำนวน", flex: 2, align: "right" },
      { key: "price", header: `ราคา/หน่วย (${sym})`, flex: 3, align: "right" },
      { key: "total", header: `รวม (${sym})`, flex: 3, align: "right" },
    ],
    rows,
    totals: [
      { label: `ยอดรวมทั้งใบ (${sym})`, value: `${sym}${money(sum)}`, strong: true },
      ...(thb != null ? [{ label: "≈ เป็นเงินบาท", value: `฿${money(thb)}` }] : []),
    ],
    note: po.note,
  };
}

// ════════════════════════════════════════════════════════════════════
// ใบโอนสินค้า (transfer)
// ════════════════════════════════════════════════════════════════════
export async function buildTransferDocImage(id: string): Promise<DocImageInput | null> {
  const session = await requireSession();
  requireDcManager(session.user.role);
  const orgId = session.user.org_id;

  const [tf, org] = await Promise.all([
    prisma.dcTransfer.findFirst({
      where: { id, orgId },
      select: {
        transferCode: true, status: true, note: true, dispatchedAt: true,
        fromWarehouseId: true, toWarehouseId: true, toBranchId: true, toLabel: true, dispatchedByUserId: true,
        lines: {
          orderBy: { id: "asc" },
          select: { qty: true, qtyReceived: true, product: { select: { name: true, sku: true } } },
        },
      },
    }),
    loadOrg(orgId),
  ]);
  if (!tf) return null;

  const whIds = [tf.fromWarehouseId, tf.toWarehouseId].filter((x): x is string => !!x);
  const [whs, branch, dispatcher] = await Promise.all([
    prisma.dcWarehouse.findMany({ where: { orgId, id: { in: whIds } }, select: { id: true, name: true } }),
    tf.toBranchId ? prisma.branch.findUnique({ where: { id: tf.toBranchId }, select: { name: true } }) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: tf.dispatchedByUserId }, select: { name: true } }),
  ]);
  const whName = (wid: string | null) => (wid ? whs.find((w) => w.id === wid)?.name ?? "—" : "—");
  const destination = tf.toWarehouseId ? whName(tf.toWarehouseId) : tf.toLabel || branch?.name || "—";

  let totSend = 0;
  let totRecv = 0;
  const rows = tf.lines.map((l) => {
    totSend += l.qty;
    totRecv += l.qtyReceived ?? 0;
    const nameSku = `${l.product?.name ?? "—"}${l.product?.sku ? ` · ${l.product.sku}` : ""}`;
    return {
      cells: {
        name: nameSku,
        qty: n0(l.qty),
        received: l.qtyReceived != null ? n0(l.qtyReceived) : "-",
      },
    };
  });

  return {
    org,
    docTitle: "ใบโอนสินค้า",
    docTitleEn: "Stock Transfer Note",
    code: tf.transferCode,
    filename: `TF-${tf.transferCode}`,
    headerRight: [
      { label: "วันที่ส่ง", value: longDate(tf.dispatchedAt) },
      { label: "สถานะ", value: TRANSFER_STATUS_TH[tf.status] ?? tf.status },
    ],
    metaLeft: [
      { label: "จากคลัง", value: whName(tf.fromWarehouseId) },
      { label: "ผู้ส่ง", value: dispatcher?.name ?? "—" },
    ],
    metaRight: [{ label: "ไปยัง", value: destination }],
    columns: [
      { key: "name", header: "สินค้า", flex: 6, align: "left" },
      { key: "qty", header: "จำนวนส่ง", flex: 2, align: "right" },
      { key: "received", header: "รับแล้ว", flex: 2, align: "right" },
    ],
    rows,
    totals: [
      { label: "รวมส่ง (ชิ้น)", value: n0(totSend), strong: true },
      ...(totRecv > 0 ? [{ label: "รวมรับแล้ว (ชิ้น)", value: n0(totRecv) }] : []),
    ],
    note: tf.note,
  };
}

// ════════════════════════════════════════════════════════════════════
// ใบนับสต๊อก (count) — reuse getCountSheet (gate + scope ครบในตัว)
// ════════════════════════════════════════════════════════════════════
export async function buildCountDocImage(id: string): Promise<DocImageInput | null> {
  const session = await requireSession();
  requireDcFloor(session.user.role);
  const orgId = session.user.org_id;

  const [res, org] = await Promise.all([getCountSheet(id), loadOrg(orgId)]);
  if (!res.ok) return null;
  const sheet = res.sheet;

  const rows = sheet.lines.map((l) => {
    const nameSku = `${l.name}${l.sku && l.sku !== "—" ? ` · ${l.sku}` : ""}`;
    return {
      cells: {
        name: nameSku,
        systemQty: `${n0(l.systemQty)}${l.unit ? ` ${l.unit}` : ""}`,
        countedQty: n0(l.countedQty),
        variance: varianceText(l.variance),
      },
    };
  });

  const netText = sheet.netVariance === 0 ? "ตรงพอดี" : `${sheet.netVariance > 0 ? "+" : ""}${n0(sheet.netVariance)}`;

  return {
    org,
    docTitle: "ใบนับสต๊อก",
    docTitleEn: "Stock Count Sheet",
    code: sheet.countCode,
    filename: `CNT-${sheet.countCode}`,
    headerRight: [
      { label: "วันที่นับ", value: longDateTime(sheet.countedAt) },
      { label: "ส่วนต่างรวม", value: netText },
    ],
    metaLeft: [
      { label: "คลัง", value: sheet.warehouseName ?? "—" },
      { label: "ผู้นับ", value: sheet.actorName ?? "—" },
    ],
    metaRight: [{ label: "จำนวนรายการ", value: `${n0(sheet.lines.length)} รายการ` }],
    columns: [
      { key: "name", header: "สินค้า / SKU", flex: 6, align: "left" },
      { key: "systemQty", header: "ระบบมี", flex: 2, align: "right" },
      { key: "countedQty", header: "นับได้", flex: 2, align: "right" },
      { key: "variance", header: "ขาด/เกิน", flex: 3, align: "right" },
    ],
    rows,
    totals: [{ label: "ส่วนต่างรวม (ขาดหักเกิน)", value: netText, strong: true }],
    note: sheet.note,
  };
}
