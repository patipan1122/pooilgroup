// DC · หลังบ้าน · สร้างใบรับสินค้า (GRN)
// โหลดคลัง + ชิปเมนต์ (ที่ยังไม่รับครบ) + ใบสั่งซื้อ + สินค้า ส่งให้ฟอร์ม client.
// รองรับ ?shipmentId=... จากปุ่มในหน้าชิปเมนต์ → preselect + pre-fill รายการ.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { GrnForm, type ShipmentOption, type GrnPoOption } from "./grn-form";
import { SHIPMENT_STATUS_LABEL } from "@/lib/dc/nav";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ shipmentId?: string }>;

export default async function DcNewGrnPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { shipmentId } = await searchParams;

  const [chrome, shipments, pos, products] = await Promise.all([
    getDcOfficeChrome(orgId),
    // ชิปเมนต์ที่ยังไม่ได้ยกเลิก (ดึงรายการมา pre-fill ปริมาณคาดหวัง)
    prisma.dcShipment.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        shipmentCode: true,
        status: true,
        poId: true,
        lines: { orderBy: { id: "asc" }, select: { productId: true, qty: true } },
      },
    }),
    prisma.dcPurchaseOrder.findMany({
      where: { orgId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poCode: true,
        status: true,
        lines: { orderBy: { id: "asc" }, select: { productId: true, qty: true } },
      },
    }),
    prisma.dcProduct.findMany({
      where: { orgId, active: true },
      orderBy: [{ type: "asc" }, { sku: "asc" }],
      select: { id: true, sku: true, name: true },
    }),
  ]);

  const prodById = new Map(products.map((p) => [p.id, p]));

  const shipmentOptions: ShipmentOption[] = shipments.map((s) => ({
    id: s.id,
    shipmentCode: s.shipmentCode,
    statusLabel: SHIPMENT_STATUS_LABEL[s.status] ?? s.status,
    poId: s.poId,
    lines: s.lines.map((l) => ({
      productId: l.productId,
      sku: prodById.get(l.productId)?.sku ?? "—",
      name: prodById.get(l.productId)?.name ?? l.productId,
      qty: l.qty,
    })),
  }));

  const poOptions: GrnPoOption[] = pos.map((po) => ({
    id: po.id,
    poCode: po.poCode,
    lines: po.lines.map((l) => ({
      productId: l.productId,
      sku: prodById.get(l.productId)?.sku ?? "—",
      name: prodById.get(l.productId)?.name ?? l.productId,
      qty: l.qty,
    })),
  }));

  const warehouses = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));
  const initialShipmentId = shipmentId && shipments.some((s) => s.id === shipmentId) ? shipmentId : null;

  return (
    <DcOfficeShell active="grn" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/receipts"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#71717a", marginBottom: 4 }}
          >
            <ArrowLeft size={15} /> กลับรายการใบรับสินค้า
          </Link>
          <div className="dc-h1">รับสินค้าเข้าคลัง</div>
          <div className="dc-sub">เลือกคลัง · อิงชิปเมนต์/ใบสั่งซื้อเพื่อดึงปริมาณคาดหวัง · ใส่จำนวนรับจริง (ครบ/ขาด/เกิน/เสีย)</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <GrnForm
        warehouses={warehouses}
        shipmentOptions={shipmentOptions}
        poOptions={poOptions}
        products={products}
        initialShipmentId={initialShipmentId}
        activeWarehouseId={ctx.activeWarehouseId}
      />
      </div>
    </DcOfficeShell>
  );
}
