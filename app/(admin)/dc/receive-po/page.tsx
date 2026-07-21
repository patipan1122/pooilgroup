// DC · หน้าคลัง · "รับสินค้าตาม PO" (floor receiving)
//   พนักงานหน้าคลังเห็นใบสั่งซื้อที่ "ของมาถึงแล้วแต่ยังไม่ได้รับเข้าสต๊อก"
//   → แตะใบ → กรอกจำนวนที่รับจริง/เสียหาย + หมายเหตุ → ยืนยันรับเข้าคลัง.
//   org-scope ทุก query · สิทธิ์ floor (พนักงานแกะของจริง).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "@/lib/dc/nav";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { DcPoStatus } from "@/lib/generated/prisma/enums";
import { ReceivePoList, type ReceivablePo } from "./receive-po-panel";

export const dynamic = "force-dynamic";

// ใบที่ "สั่งแล้วแต่ยังไม่ได้รับเข้า" — กำลังเดินทาง/ถึงโกดัง/พร้อมรับเข้า/รับบางส่วน
// ⚠️ ต้องตรงกับ RECEIVABLE ใน po-actions.receivePo (ไม่งั้นใบ "พร้อมรับเข้า" หายจากหน้ารับ)
const RECEIVABLE_STATUSES: DcPoStatus[] = [
  DcPoStatus.ORDERED,
  DcPoStatus.SHIPPED,
  DcPoStatus.ARRIVED_TH,
  DcPoStatus.AT_WAREHOUSE,
  DcPoStatus.READY_TO_RECEIVE,
  DcPoStatus.PARTIAL,
];

export default async function DcReceivePoPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId, status: { in: RECEIVABLE_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      poCode: true,
      title: true,
      status: true,
      origin: true,
      createdAt: true,
      supplier: { select: { name: true } },
      lines: {
        select: {
          productId: true,
          qty: true,
          product: { select: { name: true, sku: true, unit: true, imageR2Path: true } },
        },
      },
    },
  });

  // base สำหรับสร้าง URL รูปสินค้าจาก R2 key (ส่งให้ฝั่ง client)
  const r2PublicUrl = process.env.R2_PUBLIC_URL ?? "";

  const rows: ReceivablePo[] = pos.map((po) => ({
    id: po.id,
    poCode: po.poCode,
    title: po.title ?? null,
    status: po.status,
    statusLabel: PO_STATUS_LABEL[po.status] ?? po.status,
    statusTone: PO_STATUS_TONE[po.status] ?? "draft",
    supplierName: po.supplier?.name ?? "—",
    lineCount: po.lines.length,
    lines: po.lines.map((l) => ({
      productId: l.productId,
      name: l.product?.name ?? "(ไม่พบสินค้า)",
      sku: l.product?.sku ?? "—",
      unit: l.product?.unit ?? "ชิ้น",
      imageR2Path: l.product?.imageR2Path ?? null,
      qtyOrdered: l.qty,
    })),
  }));

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">รับตามใบสั่งซื้อ (PO)</div>
          <div className="dc-sub">
            ทางหลักในการรับของ — เลือกใบที่ของมาถึง แล้วนับรับเข้า
            {ctx.activeWarehouse ? ` · รับเข้าคลัง: ${ctx.activeWarehouse.name}` : " · ยังไม่มีคลัง"}
          </div>
          <Link
            href="/dc/receive"
            style={{
              display: "inline-block",
              marginTop: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--dc-primary, #1F4FD6)",
              textDecoration: "none",
            }}
          >
            ของไม่มีใบสั่ง? รับแบบไม่มี PO ›
          </Link>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {!ctx.activeWarehouseId ? (
        <div className="dc-card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>ยังไม่มีคลัง — สร้างที่หลังบ้าน</p>
          {canManage && (
            <Link href="/dc/office/warehouses" className="dc-btn-xl" style={{ maxWidth: 280, margin: "0 auto" }}>
              + สร้างคลังแรก
            </Link>
          )}
        </div>
      ) : (
        <ReceivePoList pos={rows} warehouseId={ctx.activeWarehouseId} r2PublicUrl={r2PublicUrl} />
      )}
    </div>
  );
}
