// DC · หลังบ้าน · รายละเอียดใบสั่งซื้อ + กล่อง/พัสดุ + เปลี่ยนสถานะ + รับเข้าคลัง.
// โหลดใบ + รายการ (ชื่อสินค้า) + กล่อง (DcShipment ของ poId นี้ + ของในกล่อง) +
// ผู้ขาย + คลังที่ผู้ใช้เข้าถึงได้ (จาก ctx) → ส่งให้ <PoDetail/> (client) ทั้งหมด.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { type PoPaymentData } from "@/lib/dc/po-actions";
import { DcPoPaymentKind } from "@/lib/generated/prisma/enums";
import { PoDetail, type PoDetailData } from "./po-detail";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** ดึงชื่อผู้ใช้ (ข้าม schema) — best-effort, ไม่พังถ้าไม่เจอ. */
async function userName(orgId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const u = await prisma.user.findFirst({
      where: { id: userId, orgId },
      select: { name: true, email: true },
    });
    return u?.name ?? u?.email ?? null;
  } catch {
    return null;
  }
}

export default async function DcPoDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;

  // 1) ใบ + รายการสินค้า (ชื่อ/SKU/หน่วย)
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      poCode: true,
      status: true,
      origin: true,
      currency: true,
      fxRate: true,
      note: true,
      warehouseId: true,
      createdByUserId: true,
      approvedByUserId: true,
      approvedAt: true,
      orderedAt: true,
      createdAt: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          qty: true,
          unitPriceCny: true,
          unitPriceThb: true,
          photoR2Key: true,
          note: true,
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });

  if (!po) notFound();

  // 2) กล่อง/พัสดุ (DcShipment ของใบนี้) + ของในกล่อง (DcShipmentLine)
  //    ไม่มี relation จาก shipment line → product → ดึงชื่อสินค้า join เองด้วย map.
  const boxes = await prisma.dcShipment.findMany({
    where: { poId: id, orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      shipmentCode: true,
      trackingNo: true,
      mode: true,
      status: true,
      cbmTotal: true,
      lengthCm: true,
      widthCm: true,
      heightCm: true,
      note: true,
      lines: { select: { id: true, productId: true, qty: true } },
    },
  });

  // ชื่อสินค้าทั้งหมดที่อ้างถึง (จากบรรทัดใบ + ของในกล่อง) → 1 query
  const productNames = new Map<string, string>();
  for (const l of po.lines) productNames.set(l.product.id, l.product.name);
  const missing = new Set<string>();
  for (const b of boxes) for (const bl of b.lines) if (!productNames.has(bl.productId)) missing.add(bl.productId);
  if (missing.size > 0) {
    const extra = await prisma.dcProduct.findMany({
      where: { id: { in: [...missing] }, orgId },
      select: { id: true, name: true },
    });
    for (const p of extra) productNames.set(p.id, p.name);
  }

  // 3) ชื่อคลัง (ถ้ามี) + ผู้สร้าง/ผู้อนุมัติ
  let warehouseName: string | null = null;
  if (po.warehouseId) {
    const w = await prisma.dcWarehouse.findFirst({
      where: { id: po.warehouseId, orgId },
      select: { name: true },
    });
    warehouseName = w?.name ?? null;
  }
  const [createdBy, approvedBy] = await Promise.all([
    userName(orgId, po.createdByUserId),
    userName(orgId, po.approvedByUserId),
  ]);

  // 4) การจ่ายเงิน (ledger 2 ด่าน: ค่าของ / ค่าขนส่งในไทย) → flags ปลดล็อกสถานะ
  const paymentRows = await prisma.dcPoPayment.findMany({
    where: { orgId, poId: id },
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

  const fxRate = po.fxRate != null ? Number(po.fxRate) : null;

  // #13 ยอดแนะนำ prefill ตอนจ่าย (แก้ได้): ค่าของ = ราคารวมทั้งใบ · ค่าขนส่ง = freight ที่บันทึกในกล่อง
  const poFxForOwed = fxRate ?? 1;
  const goodsOwedSatang = Math.round(
    po.lines.reduce((s, l) => {
      const unitThb = l.unitPriceThb != null ? Number(l.unitPriceThb) : Number(l.unitPriceCny) * poFxForOwed;
      return s + l.qty * unitThb;
    }, 0) * 100,
  );
  const freightAgg = await prisma.dcShipment.aggregate({
    where: { orgId, poId: id },
    _sum: { chinaFreightThbSatang: true, intlFreightThbSatang: true },
  });
  const freightOwedSatang =
    (freightAgg._sum.chinaFreightThbSatang ?? 0) + (freightAgg._sum.intlFreightThbSatang ?? 0);

  const data: PoDetailData = {
    id: po.id,
    poCode: po.poCode,
    status: po.status,
    origin: po.origin,
    currency: po.currency,
    fxRate,
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
      contents: b.lines.map((bl) => ({
        id: bl.id,
        productId: bl.productId,
        name: productNames.get(bl.productId) ?? "— สินค้า —",
        qty: bl.qty,
      })),
    })),
  };

  // คลังที่ผู้ใช้เข้าถึงได้ (สำหรับ dropdown รับเข้า)
  const warehouses = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));

  const r2Public = process.env.R2_PUBLIC_URL ?? "";

  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

  return (
    <DcOfficeShell active="po" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <Link href="/dc/office/purchasing" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", marginBottom: 8, textDecoration: "none" }}>
          <ArrowLeft size={15} /> กลับรายการใบสั่งซื้อ
        </Link>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>ใบสั่งซื้อ {po.poCode}</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>รายการสินค้า · กล่อง/พัสดุ · เปลี่ยนสถานะ · รับเข้าคลัง</p>
        </div>

        <PoDetail
          data={data}
          payments={payments}
          goodsPaid={goodsPaid}
          thaiFreightPaid={thaiFreightPaid}
          goodsOwedSatang={goodsOwedSatang}
          freightOwedSatang={freightOwedSatang}
          warehouses={warehouses}
          canManage={canDcManage(ctx.session.user.role)}
          r2PublicUrl={r2Public}
        />
      </div>
    </DcOfficeShell>
  );
}
