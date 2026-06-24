// DC · หลังบ้าน · รายการใบสั่งซื้อ (PO list)
// แสดงใบสั่งซื้อทั้งหมดของ org เป็นการ์ดชื่อร้าน/ผู้ขาย (กดกางดูรายการ) +
// แท็บกรองสถานะ + สลับมุมมอง Kanban. รองรับใบจีน (¥) และใบไทย (฿).
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PurchasingTabs } from "@/components/dc/purchasing-tabs";
import { PoListView, type PoListItem } from "./po-list-view";

export const dynamic = "force-dynamic";

export default async function DcPurchasingPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  // โหลดใบ + ผู้ขาย + บรรทัด (ชื่อสินค้า/จำนวน/ราคา) + จำนวนกล่อง — ใหม่สุดก่อน
  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      poCode: true,
      status: true,
      origin: true,
      currency: true,
      createdAt: true,
      orderedAt: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          qty: true,
          unitPriceCny: true,
          product: { select: { name: true, sku: true } },
        },
      },
      _count: { select: { shipments: true } },
    },
  });

  const items: PoListItem[] = pos.map((po) => {
    const total = po.lines.reduce((sum, l) => sum + l.qty * Number(l.unitPriceCny), 0);
    return {
      id: po.id,
      poCode: po.poCode,
      status: po.status,
      origin: po.origin,
      currency: po.currency,
      supplierName: po.supplier?.name ?? null,
      total,
      lineCount: po.lines.length,
      boxCount: po._count.shipments,
      date: (po.orderedAt ?? po.createdAt).toISOString(),
      lines: po.lines.map((l) => ({
        id: l.id,
        name: l.product.name,
        sku: l.product.sku,
        qty: l.qty,
        unitPrice: Number(l.unitPriceCny),
      })),
    };
  });

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ใบสั่งซื้อ</div>
          <div className="dc-sub">
            สั่งของจากจีน (¥) และซื้อในไทย (฿) · กางการ์ดดูรายการ · ติดตามสถานะตั้งแต่สั่งถึงรับเข้าคลัง
          </div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <PurchasingTabs />

      <PoListView items={items} />
    </div>
  );
}
