// DC · หน้าคลัง · รายละเอียดใบโอน + ยืนยันปลายทางรับ (floor)
//   • gate: requireDcFloor + scope คลัง — เปิดได้เฉพาะใบที่ from- หรือ to-warehouse
//     อยู่ในคลังที่ผู้ใช้ผูกสิทธิ์ (กันเปิดใบของไซต์อื่นด้วยการเดา id).
//   • reuse <TransferConfirm> เดียวกับหลังบ้าน → ผู้รับเห็นปุ่ม "✓ ถึงแล้ว ครบ" / "⚠ ไม่ครบ/เสียหาย".
//   • การรับจริงเรียก confirmTransfer เดิม (atomic status-reserve · กันกดซ้ำ) — ไม่มี write path ที่สอง.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext, getAllowedWarehouses } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import { DcTransferDestType } from "@/lib/generated/prisma/enums";
import { TransferConfirm, type TransferConfirmData } from "@/app/(admin)/dc/office/transfers/[id]/transfer-confirm";

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

export default async function DcTransferFloorDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
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

  // ── SCOPE GATE: เปิดได้เฉพาะใบที่ from- หรือ to-warehouse ∈ คลังที่ผู้ใช้ผูกสิทธิ์ ──
  // (กันพนักงานเดา id เปิดดูใบของคลัง/ไซต์ที่ไม่ได้รับมอบหมาย)
  const allowed = await getAllowedWarehouses(ctx.session);
  const allowedIds = new Set(allowed.map((w) => w.id));
  const inScope =
    allowedIds.has(transfer.fromWarehouseId) ||
    (!!transfer.toWarehouseId && allowedIds.has(transfer.toWarehouseId));
  if (!inScope) notFound();

  // ชื่อคลัง (ต้นทาง + ปลายทาง warehouse)
  const whIds = [transfer.fromWarehouseId, transfer.toWarehouseId].filter(Boolean) as string[];
  const warehouses = whIds.length
    ? await prisma.dcWarehouse.findMany({
        where: { id: { in: whIds }, orgId },
        select: { id: true, name: true },
      })
    : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  // สินค้ารายบรรทัด (+ รูป)
  const productIds = [...new Set(transfer.lines.map((l) => l.productId))];
  const products = productIds.length
    ? await prisma.dcProduct.findMany({
        where: { id: { in: productIds }, orgId },
        select: { id: true, sku: true, name: true, unit: true, imageR2Path: true },
      })
    : [];
  const prodById = new Map(products.map((p) => [p.id, p]));

  // resolve รูปเป็น URL เต็มฝั่ง server
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;

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
    // ปุ่มรับ = โชว์เฉพาะคนที่ผูกสิทธิ์ "คลังปลายทาง" (คนต้นทางเปิดดูได้แต่กดรับไม่ได้)
    canReceive: !!transfer.toWarehouseId && allowedIds.has(transfer.toWarehouseId),
    // ปุ่มยกเลิกใบโอน = เฉพาะผู้จัดการ (staff เห็นแต่ปุ่มไม่ได้)
    canCancel: canDcManage(ctx.session.user.role),
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

  return (
    <div className="dc-page">
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/dc/transfers"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--dc-muted)",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={15} /> กลับรายการใบโอน
        </Link>
      </div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dc-ink)" }}>
          ใบโอน {transfer.transferCode}
        </h1>
        <p style={{ margin: "5px 0 0", color: "var(--dc-muted)", fontSize: 14 }}>
          {data.fromName} → {data.destName}
        </p>
      </div>

      <TransferConfirm data={data} />
    </div>
  );
}
