// DC · หลังบ้าน · รายละเอียดใบโอน + ยืนยันปลายทางรับ (1 tap หรือ รายบรรทัดถ้าไม่ครบ)
//   • IN_TRANSIT → โชว์ปุ่มใหญ่ "✓ ถึงแล้ว ครบ" / "⚠ ไม่ครบ/เสียหาย" (กรอกจำนวนรับรายบรรทัด)
//   • CONFIRMED / AUTO_UNVERIFIED → อ่านอย่างเดียว + badge
//   • ต้นทุนที่พกมา (carried cost) โชว์รายบรรทัด
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { TransferConfirm, type TransferConfirmData } from "./transfer-confirm";
import { DcDocDownload } from "@/components/dc/print-controls";

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
      // Wave 6 — ปลายทางสาขาตู้คีบ (ClawFleet): toModule/toBranchId ระบุว่าของจะเข้าสโตร์สาขาจริง
      toModule: true,
      toBranchId: true,
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
        select: { id: true, sku: true, name: true, unit: true, imageR2Path: true },
      })
    : [];
  const prodById = new Map(products.map((p) => [p.id, p]));

  // resolve รูปสินค้าเป็น URL เต็มฝั่ง server (client อ่าน env ไม่ได้)
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

  const destName =
    transfer.destType === DcTransferDestType.WAREHOUSE && transfer.toWarehouseId
      ? whName.get(transfer.toWarehouseId) ?? "คลังปลายทาง"
      : transfer.toLabel ?? "สาขา/โมดูล";

  // Wave 6 — ปลายทางเป็นสาขาตู้คีบ (ClawFleet) ไหม → โชว์ badge "ของจะเข้าสโตร์สาขา"
  //   (businessType=claw_machine ยืนยันว่าเป็นสาขาตู้คีบจริง · match เงื่อนไข confirmTransfer)
  let clawfleetBranchName: string | null = null;
  if (transfer.destType === DcTransferDestType.MODULE && transfer.toBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: transfer.toBranchId, orgId, businessType: "claw_machine" },
      select: { name: true },
    });
    if (branch) clawfleetBranchName = branch.name;
  }

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
    clawfleetBranchName,
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
        imageUrl: toImageUrl(p?.imageR2Path),
      };
    }),
  };

  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

  return (
    <DcOfficeShell active="transfer" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <Link href="/dc/office/transfers" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", marginBottom: 8, textDecoration: "none" }}>
          <ArrowLeft size={15} /> กลับรายการใบโอน
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>ใบโอน {transfer.transferCode}</h1>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>{data.fromName} → {data.destName}</p>
          </div>
          <DcDocDownload
            pngHref={`/dc/office/transfers/${id}/image`}
            printHref={`/dc/office/transfers/${id}/print`}
          />
        </div>

        <TransferConfirm data={data} />
      </div>
    </DcOfficeShell>
  );
}
