// DC · หน้า "ปริ้นฉลาก" (floor labels) — สแกน/ค้นหาสินค้า → ใส่ตะกร้า → พิมพ์ฉลาก QR 58มม.
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import { LabelsWorkspace } from "./labels-workspace";

export const dynamic = "force-dynamic";

export default async function DcLabelsPage() {
  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ปริ้นฉลาก</div>
          <div className="dc-sub">พิมพ์ฉลาก QR 58มม. แปะสินค้า</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      <LabelsWorkspace />
    </div>
  );
}
