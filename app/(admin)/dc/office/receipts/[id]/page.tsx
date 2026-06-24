// DC · หลังบ้าน · รายละเอียดใบรับสินค้า (GRN) + ต้นทุนนำเข้าต่อบรรทัด + สถานะ TRCloud
// ต้นทุนต่อบรรทัดอ่านจาก DcCostLayer (สร้างโดย bridge ตอน postGrn) — READ อย่างเดียว.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { GrnDetail, type GrnDetailData } from "./grn-detail";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function DcGrnDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;
  const grn = await prisma.dcGoodsReceipt.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      grnCode: true,
      warehouseId: true,
      postStatus: true,
      note: true,
      receivedAt: true,
      poId: true,
      shipment: { select: { id: true, shipmentCode: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productId: true,
          qtyExpected: true,
          qtyReceived: true,
          qtyDamaged: true,
          costLayerId: true,
          note: true,
          product: { select: { sku: true, name: true, unit: true } },
        },
      },
    },
  });

  if (!grn) notFound();

  // คลัง + PO code (join เอง)
  const [wh, po] = await Promise.all([
    prisma.dcWarehouse.findFirst({ where: { id: grn.warehouseId, orgId }, select: { name: true } }),
    grn.poId
      ? prisma.dcPurchaseOrder.findFirst({ where: { id: grn.poId, orgId }, select: { poCode: true } })
      : Promise.resolve(null),
  ]);

  // ต้นทุนนำเข้าต่อชิ้น (cost layers ของ GRN นี้) — map ทั้ง id และ product
  const layers = await prisma.dcCostLayer.findMany({
    where: { orgId, grnId: id },
    select: {
      id: true,
      productId: true,
      qty: true,
      goodsThbSatang: true,
      dutyThbSatang: true,
      freightThbSatang: true,
      brokerThbSatang: true,
      insuranceThbSatang: true,
      landedUnitSatang: true,
      vatClaimableSatang: true,
    },
  });
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const layerByProduct = new Map(layers.map((l) => [l.productId, l]));

  const data: GrnDetailData = {
    id: grn.id,
    grnCode: grn.grnCode,
    postStatus: grn.postStatus,
    note: grn.note,
    receivedAt: grn.receivedAt.toISOString(),
    warehouseName: wh?.name ?? null,
    poCode: po?.poCode ?? null,
    shipmentId: grn.shipment?.id ?? null,
    shipmentCode: grn.shipment?.shipmentCode ?? null,
    lines: grn.lines.map((l) => {
      const layer =
        (l.costLayerId ? layerById.get(l.costLayerId) : undefined) ?? layerByProduct.get(l.productId) ?? null;
      return {
        id: l.id,
        sku: l.product.sku,
        name: l.product.name,
        unit: l.product.unit,
        qtyExpected: l.qtyExpected,
        qtyReceived: l.qtyReceived,
        qtyDamaged: l.qtyDamaged,
        note: l.note,
        cost: layer
          ? {
              goodsThbSatang: layer.goodsThbSatang,
              dutyThbSatang: layer.dutyThbSatang,
              freightThbSatang: layer.freightThbSatang,
              brokerThbSatang: layer.brokerThbSatang,
              insuranceThbSatang: layer.insuranceThbSatang,
              landedUnitSatang: layer.landedUnitSatang,
              vatClaimableSatang: layer.vatClaimableSatang,
              qty: layer.qty,
            }
          : null,
      };
    }),
  };

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/receipts"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#71717a", marginBottom: 4 }}
          >
            <ArrowLeft size={15} /> กลับรายการใบรับสินค้า
          </Link>
          <div className="dc-h1">ใบรับสินค้า {grn.grnCode}</div>
          <div className="dc-sub">รายการรับเข้า · ต้นทุนนำเข้าต่อชิ้น · สถานะลง TRCloud</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <GrnDetail data={data} canManage={canDcManage(ctx.session.user.role)} />
    </div>
  );
}
