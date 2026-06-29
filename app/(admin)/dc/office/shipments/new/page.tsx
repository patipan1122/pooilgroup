// DC · หลังบ้าน · สร้างชิปเมนต์ใหม่
// โหลดใบสั่งซื้อ (เลือกเพื่อ pre-fill รายการ) + สินค้า (active) ส่งให้ฟอร์ม client.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { ShipmentForm, type PoOption } from "./shipment-form";

export const dynamic = "force-dynamic";

export default async function DcNewShipmentPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [chrome, pos, products] = await Promise.all([
    getDcOfficeChrome(orgId),
    // ใบสั่งซื้อที่ "ของกำลังจะมา" (สั่งแล้ว/รับบางส่วน) ขึ้นก่อน — แต่ให้เลือกได้ทุกใบที่ไม่ยกเลิก
    prisma.dcPurchaseOrder.findMany({
      where: { orgId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poCode: true,
        status: true,
        fxRate: true,
        lines: {
          orderBy: { id: "asc" },
          select: {
            productId: true,
            qty: true,
            cbmPerUnit: true,
            product: { select: { sku: true, name: true } },
          },
        },
      },
    }),
    prisma.dcProduct.findMany({
      where: { orgId, active: true },
      orderBy: [{ type: "asc" }, { sku: "asc" }],
      select: { id: true, sku: true, name: true },
    }),
  ]);

  const poOptions: PoOption[] = pos.map((po) => ({
    id: po.id,
    poCode: po.poCode,
    status: po.status,
    fxRate: po.fxRate != null ? Number(po.fxRate) : null,
    lines: po.lines.map((l) => ({
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      qty: l.qty,
      // CBM ทั้งบรรทัด = CBM/ชิ้น × จำนวน (ฟอร์มเอาไป pre-fill)
      cbm: l.cbmPerUnit != null ? Number(l.cbmPerUnit) * l.qty : null,
    })),
  }));

  return (
    <DcOfficeShell active="ship" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/shipments"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#71717a", marginBottom: 4 }}
          >
            <ArrowLeft size={15} /> กลับรายการชิปเมนต์
          </Link>
          <div className="dc-h1">สร้างชิปเมนต์</div>
          <div className="dc-sub">เลือกใบสั่งซื้อเพื่อดึงรายการอัตโนมัติ · หรือใส่สินค้าเอง → บันทึกเป็น "เตรียมส่ง"</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <ShipmentForm poOptions={poOptions} products={products} />
      </div>
    </DcOfficeShell>
  );
}
