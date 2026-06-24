// DC · หลังบ้าน · สร้างใบสั่งซื้อจีนใหม่
// โหลดผู้ขาย (active) + คลัง + สินค้า (active) ส่งให้ฟอร์ม client.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PoForm } from "./po-form";

export const dynamic = "force-dynamic";

export default async function DcNewPoPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const [suppliers, products] = await Promise.all([
    prisma.dcSupplier.findMany({
      where: { orgId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.dcProduct.findMany({
      where: { orgId, active: true },
      orderBy: [{ type: "asc" }, { sku: "asc" }],
      select: { id: true, sku: true, name: true, barcode: true, unit: true },
    }),
  ]);

  // คลังที่ผู้ใช้เข้าถึงได้ (จาก ctx)
  const warehouses = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/purchasing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#71717a",
              marginBottom: 4,
            }}
          >
            <ArrowLeft size={15} /> กลับรายการใบสั่งซื้อ
          </Link>
          <div className="dc-h1">สร้างใบสั่งซื้อจีน</div>
          <div className="dc-sub">เลือกผู้ขาย · เพิ่มสินค้า · ใส่ราคา CNY + ขนาด → บันทึกเป็นร่าง</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <PoForm suppliers={suppliers} warehouses={warehouses} products={products} />
    </div>
  );
}
