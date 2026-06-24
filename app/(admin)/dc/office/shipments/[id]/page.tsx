// DC · หลังบ้าน · รายละเอียดชิปเมนต์ + แก้ค่าขนส่ง/ต้นทุนนำเข้า + คุมสถานะ
// (DcShipmentLine ไม่มี relation → product ตรง ๆ → join ชื่อสินค้าเองในนี้)
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { ShipmentDetail, type ShipmentDetailData } from "./shipment-detail";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function DcShipmentDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;
  const ship = await prisma.dcShipment.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      shipmentCode: true,
      status: true,
      mode: true,
      trackingNo: true,
      cbmTotal: true,
      chinaFreightThbSatang: true,
      intlFreightThbSatang: true,
      dutyThbSatang: true,
      brokerThbSatang: true,
      insuranceThbSatang: true,
      fxRate: true,
      fxDate: true,
      etd: true,
      eta: true,
      note: true,
      createdAt: true,
      po: { select: { poCode: true } },
      lines: { orderBy: { id: "asc" }, select: { id: true, productId: true, qty: true, cbm: true } },
      grns: { orderBy: { receivedAt: "desc" }, select: { id: true, grnCode: true, postStatus: true } },
    },
  });

  if (!ship) notFound();

  // ชื่อสินค้าของแต่ละบรรทัด (join เอง)
  const productIds = [...new Set(ship.lines.map((l) => l.productId))];
  const products = productIds.length
    ? await prisma.dcProduct.findMany({
        where: { id: { in: productIds }, orgId },
        select: { id: true, sku: true, name: true, unit: true },
      })
    : [];
  const prodById = new Map(products.map((p) => [p.id, p]));

  const data: ShipmentDetailData = {
    id: ship.id,
    shipmentCode: ship.shipmentCode,
    status: ship.status,
    mode: ship.mode,
    trackingNo: ship.trackingNo,
    cbmTotal: ship.cbmTotal != null ? Number(ship.cbmTotal) : null,
    chinaFreightThbSatang: ship.chinaFreightThbSatang,
    intlFreightThbSatang: ship.intlFreightThbSatang,
    dutyThbSatang: ship.dutyThbSatang,
    brokerThbSatang: ship.brokerThbSatang,
    insuranceThbSatang: ship.insuranceThbSatang,
    fxRate: ship.fxRate != null ? Number(ship.fxRate) : null,
    fxDate: ship.fxDate ? ship.fxDate.toISOString() : null,
    etd: ship.etd ? ship.etd.toISOString() : null,
    eta: ship.eta ? ship.eta.toISOString() : null,
    note: ship.note,
    createdAt: ship.createdAt.toISOString(),
    poCode: ship.po?.poCode ?? null,
    lines: ship.lines.map((l) => {
      const p = prodById.get(l.productId);
      return {
        id: l.id,
        sku: p?.sku ?? "—",
        name: p?.name ?? l.productId,
        unit: p?.unit ?? "ชิ้น",
        qty: l.qty,
        cbm: l.cbm != null ? Number(l.cbm) : null,
      };
    }),
    grns: ship.grns.map((g) => ({ id: g.id, grnCode: g.grnCode, postStatus: g.postStatus })),
  };

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/shipments"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#71717a", marginBottom: 4 }}
          >
            <ArrowLeft size={15} /> กลับรายการชิปเมนต์
          </Link>
          <div className="dc-h1">ชิปเมนต์ {ship.shipmentCode}</div>
          <div className="dc-sub">รายการ · ค่าขนส่ง/ต้นทุนนำเข้า · สถานะ → รับเข้าคลัง (GRN)</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <ShipmentDetail data={data} canManage={canDcManage(ctx.session.user.role)} />
    </div>
  );
}
