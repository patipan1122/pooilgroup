// DC · หลังบ้าน · รับสินค้าเข้าคลัง (GRN) — #12 (CEO 2026-06-29)
//   • โหมดหลัก = "รับตามใบสั่งซื้อ (PO)": มาทาง ?po=<id> → ดึงสรุป สั่ง/รับแล้ว/คงค้าง
//       มา pre-fill (รับจริง = คงค้าง) → ส่งผ่าน receivePo (มีด่านกันรับซ้ำ + ด่านค่าขนส่ง).
//   • โหมดรอง = "รับของไม่มีใบสั่งซื้อ": ฟอร์มอิสระ (createGrn) — สำหรับของแถม/ตัวอย่าง/ซื้อสด
//       เท่านั้น (server บังคับ poId=null กันสต๊อกซ้อน).
//   • ยังรองรับ ?shipmentId=... (โหมดไม่มี PO · pre-fill ปริมาณจากชิปเมนต์).
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { getPoReceivingSummary } from "@/lib/dc/po-actions";
import { GrnForm, type ShipmentOption, type GrnPoOption, type PoReceivePrefill } from "./grn-form";
import { SHIPMENT_STATUS_LABEL } from "@/lib/dc/nav";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ shipmentId?: string; po?: string }>;

export default async function DcNewGrnPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { shipmentId, po } = await searchParams;

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

  // ── โหมดรับตามใบสั่งซื้อ (PO-driven) — มาทาง ?po=<id> ─────────────────
  // ดึง "สั่ง / รับแล้ว / คงค้าง" ต่อสินค้า มา pre-fill (รับจริง = คงค้าง) + หัวใบ PO + ผู้ขาย.
  // ทุก query org-scope (getPoReceivingSummary เช็ค org ในตัว · meta query filter orgId).
  let poReceive: PoReceivePrefill | null = null;
  if (po) {
    const [summary, poMeta] = await Promise.all([
      getPoReceivingSummary(po),
      prisma.dcPurchaseOrder.findFirst({
        where: { id: po, orgId },
        select: { id: true, poCode: true, origin: true, supplier: { select: { name: true } } },
      }),
    ]);
    if (summary && poMeta) {
      poReceive = {
        poId: poMeta.id,
        poCode: poMeta.poCode,
        supplierName: poMeta.supplier?.name ?? null,
        isChina: poMeta.origin === "CHINA",
        fullyReceived: summary.fullyReceived,
        products: summary.products.map((p) => ({
          productId: p.productId,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          ordered: p.ordered,
          received: p.received,
          remaining: p.remaining,
        })),
      };
    }
  }

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
          <div className="dc-h1">
            {poReceive ? `รับสินค้าตามใบสั่งซื้อ ${poReceive.poCode}` : "รับสินค้าเข้าคลัง"}
          </div>
          <div className="dc-sub">
            {poReceive
              ? "เทียบจำนวน สั่ง · รับแล้ว · คงค้าง — ใส่จำนวนรับจริงต่อรายการ (ขาด/เกินจะขึ้นให้เห็นทันที)"
              : "เลือกคลัง · ใส่จำนวนรับจริง (ครบ/ขาด/เกิน/เสีย) — ของที่มีใบสั่งซื้อให้รับผ่านใบสั่งซื้อ"}
          </div>
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
        poReceive={poReceive}
      />
      </div>
    </DcOfficeShell>
  );
}
