// DC · หลังบ้าน · รายละเอียดใบโอน + ยืนยันปลายทางรับ (1 tap หรือ รายบรรทัดถ้าไม่ครบ)
//   • IN_TRANSIT → โชว์ปุ่มใหญ่ "✓ ถึงแล้ว ครบ" / "⚠ ไม่ครบ/เสียหาย" (กรอกจำนวนรับรายบรรทัด)
//   • CONFIRMED / AUTO_UNVERIFIED → อ่านอย่างเดียว + badge
//   • ต้นทุนที่พกมา (carried cost) โชว์รายบรรทัด
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { TransferConfirm, type TransferConfirmData } from "./transfer-confirm";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function DcTransferDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;
  const transfer = await prisma.dcTransfer.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      transferCode: true,
      status: true,
      destType: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      toLabel: true,
      sameSite: true,
      dispatchedAt: true,
      confirmedAt: true,
      note: true,
      lines: {
        orderBy: { id: "asc" },
        select: { id: true, productId: true, qty: true, qtyReceived: true, unitCostSatang: true },
      },
    },
  });
  if (!transfer) notFound();

  // ชื่อคลัง (ต้นทาง + ปลายทาง warehouse)
  const whIds = [transfer.fromWarehouseId, transfer.toWarehouseId].filter(Boolean) as string[];
  const warehouses = whIds.length
    ? await prisma.dcWarehouse.findMany({
        where: { id: { in: whIds }, orgId },
        select: { id: true, name: true },
      })
    : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  // ชื่อสินค้ารายบรรทัด
  const productIds = [...new Set(transfer.lines.map((l) => l.productId))];
  const products = productIds.length
    ? await prisma.dcProduct.findMany({
        where: { id: { in: productIds }, orgId },
        select: { id: true, sku: true, name: true, unit: true },
      })
    : [];
  const prodById = new Map(products.map((p) => [p.id, p]));

  const destName =
    transfer.destType === DcTransferDestType.WAREHOUSE && transfer.toWarehouseId
      ? whName.get(transfer.toWarehouseId) ?? "คลังปลายทาง"
      : transfer.toLabel ?? "สาขา/โมดูล";

  const data: TransferConfirmData = {
    id: transfer.id,
    transferCode: transfer.transferCode,
    status: transfer.status,
    destType: transfer.destType,
    fromName: whName.get(transfer.fromWarehouseId) ?? "คลังต้นทาง",
    destName,
    sameSite: transfer.sameSite,
    dispatchedAt: fmtDate(transfer.dispatchedAt),
    confirmedAt: transfer.confirmedAt ? fmtDate(transfer.confirmedAt) : null,
    note: transfer.note,
    statusLabel: TRANSFER_STATUS_LABEL[transfer.status] ?? transfer.status,
    lines: transfer.lines.map((l) => {
      const p = prodById.get(l.productId);
      return {
        id: l.id,
        sku: p?.sku ?? "—",
        name: p?.name ?? l.productId,
        unit: p?.unit ?? "ชิ้น",
        qty: l.qty,
        qtyReceived: l.qtyReceived,
        unitCostSatang: l.unitCostSatang,
      };
    }),
  };

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/transfers"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#71717a", marginBottom: 4 }}
          >
            <ArrowLeft size={15} /> กลับรายการใบโอน
          </Link>
          <div className="dc-h1">ใบโอน {transfer.transferCode}</div>
          <div className="dc-sub">{data.fromName} → {data.destName}</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <TransferConfirm data={data} />
    </div>
  );
}
