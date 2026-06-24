// DC · หลังบ้าน → จัดการโกดัง (สร้าง / เปลี่ยนชื่อ / ตั้งคลังเริ่มต้น / เปิด-ปิด)
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager, canDcManage } from "@/lib/dc/role-guard";
import { prisma } from "@/lib/prisma";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { WarehouseManager } from "./warehouse-manager";

export const dynamic = "force-dynamic";

export default async function DcWarehousesPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);

  const orgId = ctx.session.user.org_id;
  const warehouses = await prisma.dcWarehouse.findMany({
    where: { orgId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
      isActive: true,
      isDefault: true,
    },
  });

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">โกดัง</div>
          <div className="dc-sub">
            สร้างคลัง · ตั้งคลังเริ่มต้น · เปิด/ปิดการใช้งาน
          </div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <WarehouseManager warehouses={warehouses} />
    </div>
  );
}
